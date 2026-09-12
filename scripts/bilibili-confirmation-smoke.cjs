// Isolated Electron DOM/network fixture. Never connects to the user's Studio or B站.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('playwright-core')
const ts = require('typescript')

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bilibili-confirmation-smoke-'))
  let electron
  try {
    const source = await fs.readFile(
      path.resolve('src/main/article-publishing/bilibili-publication.ts'),
      'utf8',
    )
    const modulePath = path.join(temporary, 'publication.cjs')
    await fs.writeFile(
      modulePath,
      ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText,
    )
    const { observeBilibiliSubmission, finishBilibiliSubmission } = require(modulePath)
    const entry = path.join(temporary, 'main.cjs')
    await fs.writeFile(
      entry,
      `
      const {app, BrowserWindow, WebContentsView}=require('electron');
      app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
      app.whenReady().then(()=>{
        global.window=new BrowserWindow({show:false,width:1000,height:800});
        global.view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
        window.loadURL('about:blank');
        window.contentView.addChildView(view);
        view.setBounds({x:0,y:0,width:1000,height:800});
        view.webContents.loadURL('about:blank#confirmation-fixture');
      });
    `,
    )
    electron = await _electron.launch({
      executablePath: require('electron'),
      args: [entry],
      timeout: 15000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    })
    process.stderr.write('Isolated Electron launched\n')
    const context = electron.context()
    let sends = 0
    const image = 'https://i0.hdslb.com/bfs/new_dyn/fixture.png'
    // Every URL is fulfilled/aborted locally, including the apparent B站 origins.
    await context.route('**/*', async (route) => {
      const url = route.request().url()
      if (url === 'https://t.bilibili.com/h5/dynamic/specification') {
        return route.fulfill({
          contentType: 'text/html',
          body: '<h1>哔哩哔哩动态使用规范（2019年6月）</h1>',
        })
      }
      if (url === 'https://api.bilibili.com/x/dynamic/feed/create/dyn') {
        sends++
        return route.fulfill({
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ code: 0, data: { dyn_id_str: '1246694229973925912' } }),
        })
      }
      if (url === 'https://t.bilibili.com/') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><meta charset="utf-8">
          <h2>LOCAL FIXTURE — no public submission</h2><button id="publish">发布</button>
          <section id="dialog" hidden><iframe src="https://t.bilibili.com/h5/dynamic/specification"></iframe>
          <button id="confirm">确认并发送</button><button>取消</button></section>
          <script>
          document.querySelector('#publish').onclick=()=>document.querySelector('#dialog').hidden=false;
          document.querySelector('#confirm').onclick=async()=>{
            await fetch('https://api.bilibili.com/x/dynamic/feed/create/dyn',{method:'POST',body:JSON.stringify({dyn_req:{content:{contents:[{raw_text:'冻结正文'}]},pics:[{img_src:${JSON.stringify(image)}}]}})});
            document.querySelector('#dialog').hidden=true;
          };
          </script>`,
        })
      }
      return route.abort()
    })
    const page = await context
      .waitForEvent('page', {
        predicate: (page) => page.url().includes('confirmation-fixture'),
        timeout: 1000,
      })
      .catch(() => context.pages().find((page) => page.url().includes('confirmation-fixture')))
    assert(page, 'Isolated WebContentsView must be available')
    page.setDefaultTimeout(5000)
    const results = []
    for (const mode of ['accepted', 'changed-body', 'cancelled', 'disposed']) {
      process.stderr.write(`Checking ${mode}\n`)
      await page.goto('https://t.bilibili.com/')
      await page
        .frameLocator('iframe')
        .getByRole('heading', { includeHidden: true })
        .waitFor({ state: 'attached' })
      const observer = observeBilibiliSubmission(page, {
        uid: '3546384070347419',
        text: '冻结正文',
        images: [image],
      })
      const progress = []
      const before = sends
      observer.arm()
      await page.getByRole('button', { name: '发布', exact: true }).click()
      try {
        const result = finishBilibiliSubmission(page, observer, {
          isCurrent: () => mode !== 'cancelled',
          revalidate: async () => {
            if (mode === 'changed-body') throw new Error('body mismatch')
            if (mode === 'disposed') observer.dispose()
          },
          record: async (event) => progress.push(event),
        })
        if (mode === 'accepted') {
          assert.equal((await result).id, '1246694229973925912')
          assert.equal(sends - before, 1)
          assert(
            progress.some(
              (event) => event.id === 'bilibili.submission.receipt' && event.status === 'completed',
            ),
          )
        } else {
          await assert.rejects(result)
          assert.equal(sends - before, 0)
        }
        results.push({ mode, sends: sends - before, passed: true })
      } finally {
        observer.dispose()
      }
    }
    process.stdout.write(
      JSON.stringify({ fixtureOnly: true, realPlatformAcceptance: false, results }, null, 2) + '\n',
    )
  } finally {
    if (electron) await electron.close()
    await fs.rm(temporary, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
