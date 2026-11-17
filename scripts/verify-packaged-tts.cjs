const { readFileSync, statSync } = require('node:fs')
const { join } = require('node:path')

// Runs before signing for every electron-builder invocation, local and Release.
// asarUnpack alone is not a dependency inclusion rule.
function verifyPackagedTts(resourcesPath, platform, arch) {
  const modules = join(resourcesPath, 'app.asar.unpacked', 'node_modules')
  const nativeName = `sherpa-onnx-${platform === 'win32' ? 'win' : platform}-${arch}`
  const required = ['sherpa-onnx.node']
  if (platform === 'darwin')
    required.push(
      'libonnxruntime.dylib',
      'libsherpa-onnx-c-api.dylib',
      'libsherpa-onnx-cxx-api.dylib',
    )
  try {
    const wrapper = JSON.parse(readFileSync(join(modules, 'sherpa-onnx-node/package.json'), 'utf8'))
    const native = JSON.parse(readFileSync(join(modules, nativeName, 'package.json'), 'utf8'))
    if (native.name !== nativeName || native.version !== wrapper.version)
      throw new Error('native and JS engine versions differ')
    for (const file of required) {
      const entry = statSync(join(modules, nativeName, file))
      if (!entry.isFile() || entry.size === 0) throw new Error(`invalid ${file}`)
    }
  } catch (error) {
    throw new Error(`Packaged TTS engine incomplete (${nativeName}): ${error.message}`)
  }
}

module.exports = async function afterPack(context) {
  // electron-builder's Arch enum, not the architecture of the build host.
  const arch = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }[context.arch]
  const platform = context.electronPlatformName
  const resourcesPath =
    platform === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents/Resources',
        )
      : join(context.appOutDir, 'resources')
  verifyPackagedTts(resourcesPath, platform, arch)
}
module.exports.verifyPackagedTts = verifyPackagedTts
