#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <libproc.h>
#import <sys/stat.h>
#import <sys/wait.h>
#import <signal.h>
#import <stdio.h>
#import <unistd.h>
#import <stdlib.h>
#import <string.h>

// No network or elevation. Only a private, local install transaction.
static NSFileManager *files;
static NSString *transactionRoot;
static NSDictionary *transaction;

// Foundation strips /private from some paths. Match Node/libproc's filesystem canonical form.
static BOOL canonicalPathMatches(NSString *path) {
  char *canonical = realpath(path.fileSystemRepresentation, NULL);
  BOOL matches = canonical && strcmp(canonical, path.fileSystemRepresentation) == 0;
  free(canonical);
  return matches;
}

static BOOL writeRecord(NSString *name, NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  NSString *path = [transactionRoot stringByAppendingPathComponent:name];
  BOOL ok = [data writeToFile:path options:NSDataWritingAtomic error:nil];
  if (ok) chmod(path.fileSystemRepresentation, 0600);
  return ok;
}

static NSDictionary *readRecord(NSString *path) {
  struct stat info;
  if (lstat(path.fileSystemRepresentation, &info) || !S_ISREG(info.st_mode) ||
      info.st_uid != getuid() || (info.st_mode & 0077) || info.st_size > 16384) return nil;
  NSData *data = [NSData dataWithContentsOfFile:path];
  id value = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [value isKindOfClass:[NSDictionary class]] ? value : nil;
}

static BOOL privateDirectory(NSString *path) {
  struct stat info;
  return !lstat(path.fileSystemRepresentation, &info) && S_ISDIR(info.st_mode) &&
    info.st_uid == getuid() && !(info.st_mode & 0077) &&
    canonicalPathMatches(path);
}

static NSString *bundleVersion(NSString *path) {
  NSDictionary *plist = [NSDictionary dictionaryWithContentsOfFile:
    [path stringByAppendingPathComponent:@"Contents/Info.plist"]];
  return plist[@"CFBundleShortVersionString"];
}

static BOOL verifyApp(NSString *path, NSString *version) {
  if (!canonicalPathMatches(path) ||
      ![bundleVersion(path) isEqualToString:version]) return NO;
  NSString *team = transaction[@"teamId"];
  if (![team isKindOfClass:[NSString class]] || team.length != 10 ||
      [team rangeOfCharacterFromSet:
        [[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] invertedSet]].location != NSNotFound) return NO;
  NSString *requirementText = [NSString stringWithFormat:
    @"anchor apple generic and identifier \"com.cclink.studio\" and certificate leaf[subject.OU] = \"%@\"", team];
  SecRequirementRef requirement = NULL;
  SecStaticCodeRef code = NULL;
  OSStatus result = SecRequirementCreateWithString((__bridge CFStringRef)requirementText,
    kSecCSDefaultFlags, &requirement);
  if (result == errSecSuccess) result = SecStaticCodeCreateWithPath(
    (__bridge CFURLRef)[NSURL fileURLWithPath:path], kSecCSDefaultFlags, &code);
  if (result == errSecSuccess) result = SecStaticCodeCheckValidity(code,
    kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode, requirement);
  if (code) CFRelease(code);
  if (requirement) CFRelease(requirement);
  if (result != errSecSuccess) writeRecord(@"verification-error.json", @{@"status": @(result), @"version": version});
  return result == errSecSuccess;
}

static BOOL swapApplications(void) {
  NSString *target = transaction[@"targetPath"];
  NSString *candidate = transaction[@"candidatePath"];
  return renameatx_np(AT_FDCWD, target.fileSystemRepresentation,
    AT_FDCWD, candidate.fileSystemRepresentation, RENAME_SWAP) == 0;
}

static NSTask *launchApp(NSString *path, BOOL updating) {
  NSDictionary *plist = [NSDictionary dictionaryWithContentsOfFile:
    [path stringByAppendingPathComponent:@"Contents/Info.plist"]];
  NSString *name = plist[@"CFBundleExecutable"];
  if (![name isKindOfClass:[NSString class]] || ![name.lastPathComponent isEqualToString:name]) return nil;
  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:
    [path stringByAppendingPathComponent:[@"Contents/MacOS" stringByAppendingPathComponent:name]]];
  task.arguments = updating ? @[[ @"--cclink-update=" stringByAppendingString:transaction[@"nonce"]]] : @[];
  task.standardOutput = [NSFileHandle fileHandleWithNullDevice];
  task.standardError = [NSFileHandle fileHandleWithNullDevice];
  if (![task launchAndReturnError:nil]) return nil;
  if (!updating) writeRecord(@"restored.json", @{@"nonce": transaction[@"nonce"], @"pid": @(task.processIdentifier)});
  return task;
}

static BOOL committed(void) {
  NSDictionary *record = readRecord([transactionRoot stringByAppendingPathComponent:@"commit.json"]);
  return [record[@"nonce"] isEqual:transaction[@"nonce"]];
}

static void stopLaunchedApplication(void) {
  NSDictionary *record = readRecord([transactionRoot stringByAppendingPathComponent:@"launched.json"]);
  NSNumber *pidValue = record[@"pid"];
  if (![record[@"nonce"] isEqual:transaction[@"nonce"]] ||
      ![pidValue isKindOfClass:[NSNumber class]] || pidValue.intValue <= 1) return;
  pid_t pid = pidValue.intValue;
  char executable[PROC_PIDPATHINFO_MAXSIZE] = {0};
  if (!proc_pidpath(pid, executable, sizeof(executable))) return;
  NSString *path = [NSString stringWithUTF8String:executable];
  if (![path hasPrefix:[transaction[@"targetPath"] stringByAppendingString:@"/Contents/MacOS/"]]) return;
  kill(pid, SIGTERM);
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (kill(pid, 0) == 0 && deadline.timeIntervalSinceNow > 0) usleep(100000);
  if (kill(pid, 0) == 0) kill(pid, SIGKILL);
}

static void rollback(void) {
  NSString *target = transaction[@"targetPath"];
  NSString *candidate = transaction[@"candidatePath"];
  if ([bundleVersion(target) isEqual:transaction[@"targetVersion"]] &&
      verifyApp(candidate, transaction[@"currentVersion"])) {
    stopLaunchedApplication();
    if (swapApplications()) {
      writeRecord(@"result.json", @{@"status": @"rolled_back", @"code": @"install_failed"});
      launchApp(target, NO);
    } else {
      writeRecord(@"result.json", @{@"status": @"recovery_required", @"code": @"install_failed"});
    }
  }
}

static int install(void) {
  NSString *target = transaction[@"targetPath"];
  NSString *candidate = transaction[@"candidatePath"];
  NSString *stage = candidate.stringByDeletingLastPathComponent;
  NSNumber *pidValue = transaction[@"parentPid"];
  if (![pidValue isKindOfClass:[NSNumber class]]) return 2;
  pid_t oldPid = pidValue.intValue;
  if (oldPid <= 1) return 2;
  char processPath[PROC_PIDPATHINFO_MAXSIZE] = {0};
  if (!proc_pidpath(oldPid, processPath, sizeof(processPath))) return 2;
  NSString *parentExecutable = [NSString stringWithUTF8String:processPath];
  if (![parentExecutable hasPrefix:[target stringByAppendingString:@"/Contents/MacOS/"]]) return 2;
  if (!privateDirectory(stage) || ![candidate.lastPathComponent isEqual:@"candidate.app"] ||
      ![stage.stringByDeletingLastPathComponent isEqual:target.stringByDeletingLastPathComponent] ||
      ![target.pathExtension isEqual:@"app"] ||
      !verifyApp(target, transaction[@"currentVersion"]) ||
      !verifyApp(candidate, transaction[@"targetVersion"])) return 3;
  if (!writeRecord(@"ready.json", @{@"nonce": transaction[@"nonce"]})) return 4;
  // Never kill the old application. A cancelled/hung shutdown leaves it untouched.
  NSDate *exitDeadline = [NSDate dateWithTimeIntervalSinceNow:120];
  while (kill(oldPid, 0) == 0) {
    NSDictionary *cancel = readRecord([transactionRoot stringByAppendingPathComponent:@"cancel.json"]);
    if ([cancel[@"nonce"] isEqual:transaction[@"nonce"]]) return 5;
    if (exitDeadline.timeIntervalSinceNow <= 0) {
      writeRecord(@"result.json", @{@"status": @"cancelled", @"code": @"install_blocked"});
      return 5;
    }
    usleep(200000);
  }
  if (!committed() || !verifyApp(target, transaction[@"currentVersion"]) ||
      !verifyApp(candidate, transaction[@"targetVersion"])) {
    writeRecord(@"result.json", @{@"status": @"cancelled", @"code": @"install_blocked"});
    launchApp(target, NO);
    return 6;
  }
  if (!swapApplications()) {
    writeRecord(@"result.json", @{@"status": @"failed", @"code": @"install_failed"});
    launchApp(target, NO);
    return 7;
  }
  writeRecord(@"swapped.json", @{@"nonce": transaction[@"nonce"]});
  NSTask *newApp = launchApp(target, YES);
  if (newApp) writeRecord(@"launched.json", @{@"nonce": transaction[@"nonce"], @"pid": @(newApp.processIdentifier)});
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:120];
  while (newApp.running && deadline.timeIntervalSinceNow > 0) {
    NSDictionary *ack = readRecord([transactionRoot stringByAppendingPathComponent:@"started.json"]);
    if ([ack[@"nonce"] isEqual:transaction[@"nonce"]] &&
        [ack[@"version"] isEqual:transaction[@"targetVersion"]] &&
        [ack[@"pid"] intValue] == newApp.processIdentifier) {
      writeRecord(@"result.json", @{@"status": @"succeeded"});
      // Retain the previous signed App for recovery; cleanup is owned by UpdateService.
      return 0;
    }
    usleep(200000);
  }
  if (newApp.running) {
    [newApp terminate];
    NSDate *stopDeadline = [NSDate dateWithTimeIntervalSinceNow:5];
    while (newApp.running && stopDeadline.timeIntervalSinceNow > 0) usleep(100000);
    if (newApp.running) kill(newApp.processIdentifier, SIGKILL);
  }
  rollback();
  return 8;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 1;
    files = [NSFileManager defaultManager];
    transactionRoot = [NSString stringWithUTF8String:argv[1]];
    if (!privateDirectory(transactionRoot)) return 1;
    transaction = readRecord([transactionRoot stringByAppendingPathComponent:@"transaction.json"]);
    NSArray *keys = @[@"targetPath", @"candidatePath", @"currentVersion", @"targetVersion", @"teamId", @"nonce"];
    for (NSString *key in keys) {
      if (![transaction[key] isKindOfClass:[NSString class]] || [transaction[key] length] == 0) return 1;
    }
    pid_t worker = fork();
    if (worker < 0) return 1;
    if (worker == 0) {
      writeRecord(@"worker.json", @{@"pid": @(getpid())});
      _exit(install());
    }
    int state = 0;
    if (waitpid(worker, &state, 0) < 0) return 1;
    // A separate supervisor restores the old App if the worker is interrupted after swap.
    if (!WIFEXITED(state) || WEXITSTATUS(state) != 0) {
      rollback();
      // A crash between parent exit and swap must also relaunch the intact old App.
      if (!readRecord([transactionRoot stringByAppendingPathComponent:@"result.json"]) &&
          committed() && kill([transaction[@"parentPid"] intValue], 0) != 0 &&
          verifyApp(transaction[@"targetPath"], transaction[@"currentVersion"])) {
        writeRecord(@"result.json", @{@"status": @"cancelled", @"code": @"install_failed"});
        launchApp(transaction[@"targetPath"], NO);
      }
    }
    return WIFEXITED(state) ? WEXITSTATUS(state) : 9;
  }
}
