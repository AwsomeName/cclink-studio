// Isolated Electron DOM/network fixture. Never connects to the user's Studio or B站.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness loads the transpiled production CommonJS module. */
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
    const modulePath = path.join(temporary, 'bilibili-publication.js')
    await fs.writeFile(
      modulePath,
      ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText,
    )
    const { observeBilibiliSubmission, finishBilibiliSubmission } = require(modulePath)
    const adapterPath = path.join(temporary, 'adapter.cjs')
    await fs.writeFile(
      adapterPath,
      ts.transpileModule(
        await fs.readFile(
          path.resolve('src/main/article-publishing/bilibili-publishing-adapter.ts'),
          'utf8',
        ),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
      ).outputText,
    )
    const { readBilibiliComposer } = require(adapterPath)
    const bodyInputPath = path.join(temporary, 'body-input.cjs')
    await fs.writeFile(
      bodyInputPath,
      ts.transpileModule(
        await fs.readFile(path.resolve('src/main/playwright/bilibili-body-input.ts'), 'utf8'),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
      ).outputText,
    )
    const { pasteBilibiliBody } = require(bodyInputPath)
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
    let currentMode = ''
    const image = 'https://i0.hdslb.com/bfs/new_dyn/fixture.png'
    // Every URL is fulfilled/aborted locally, including the apparent B站 origins.
    await context.route('**/*', async (route) => {
      const url = route.request().url()
      if (url === 'https://t.bilibili.com/h5/dynamic/specification') {
        if (currentMode === 'delayed-document')
          await new Promise((resolve) => setTimeout(resolve, 800))
        if (['slow-document', 'cancel-during-document'].includes(currentMode))
          await new Promise((resolve) => setTimeout(resolve, 6500))
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
      if (url === image)
        return route.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
            'base64',
          ),
        })
      if (url === 'https://t.bilibili.com/') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><meta charset="utf-8">
          <h2>LOCAL FIXTURE — no public submission</h2>
          <a class="header-entry-mini" href="https://space.bilibili.com/3546384070347419">Account</a>
          <main><section>
          <input placeholder="好的标题更容易获得支持，选填20字" value="测试">
          <div contenteditable="true" placeholder="有什么想和大家分享的？">冻结正文</div>
          <div class="bili-pics-uploader"><img width="100" height="100" src="${image}"></div>
          <div class="bili-cascader-options__item is-active"><span class="bili-cascader-options__item-label">所有用户可见</span></div>
          <div class="bili-cascader-options__item"><span class="bili-cascader-options__item-label">仅自己可见</span></div>
          <button id="publish">发布</button></section></main>
          <section id="dialog" hidden><div class="bili-dyn-specification-popup__content"><iframe></iframe></div>
          <button id="confirm">确认并发送</button>${currentMode === 'missing-cancel' ? '' : '<button>取消</button>'}</section>
          <script>
          document.querySelector('#publish').onclick=()=>{
            document.querySelector('#publish').disabled=true;
            document.querySelector('#dialog').hidden=false;
            document.querySelector('iframe').src='https://t.bilibili.com/h5/dynamic/specification';
          };
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
    for (const mode of [
      'accepted',
      'delayed-document',
      'slow-document',
      'cancel-during-document',
      'missing-cancel',
      'changed-body',
      'cancelled',
      'disposed',
    ]) {
      currentMode = mode
      process.stderr.write(`Checking ${mode}\n`)
      await page.goto('https://t.bilibili.com/')
      const initial = await readBilibiliComposer(page)
      assert(initial.publishSelector, 'Initial publish must be enabled')
      const observations = []
      const observer = observeBilibiliSubmission(
        page,
        {
          uid: '3546384070347419',
          text: '冻结正文',
          images: [image],
        },
        async (facts) => {
          observations.push(facts)
        },
      )
      const progress = []
      let current = mode !== 'cancelled'
      const before = sends
      observer.arm()
      await page.getByRole('button', { name: '发布', exact: true }).click()
      try {
        const result = finishBilibiliSubmission(page, observer, {
          isCurrent: () => current,
          revalidate: async () => {
            const currentComposer = await readBilibiliComposer(page)
            assert.equal(
              currentComposer.publishSelector,
              undefined,
              'Native modal disables the entry',
            )
            assert.equal(currentComposer.immediatePublishPresent, true)
            assert.equal(currentComposer.visibility, 'public')
            assert.equal(currentComposer.uid, initial.uid)
            assert.equal(currentComposer.title, initial.title)
            assert.equal(currentComposer.text, initial.text)
            assert.deepEqual(currentComposer.images, initial.images)
            if (mode === 'changed-body') throw new Error('body mismatch')
            if (mode === 'disposed') observer.dispose()
          },
          record: async (event) => {
            progress.push(event)
            if (mode === 'cancel-during-document' && event.status === 'waiting') current = false
          },
        })
        if (['accepted', 'delayed-document', 'slow-document'].includes(mode)) {
          assert.equal((await result).id, '1246694229973925912')
          assert.equal(sends - before, 1)
          assert(
            progress.some(
              (event) => event.id === 'bilibili.submission.receipt' && event.status === 'completed',
            ),
          )
          if (mode === 'slow-document')
            assert(
              progress.some(
                (event) => event.id === 'bilibili.agreement.inspect' && event.status === 'waiting',
              ),
            )
        } else {
          if (mode === 'missing-cancel') await assert.rejects(result, /弹窗缺少可见取消按钮/u)
          else await assert.rejects(result)
          assert.equal(sends - before, 0)
        }
        results.push({ mode, sends: sends - before, passed: true })
      } finally {
        await observer.dispose()
        assert.equal(observations.at(-1).observationEnded, true)
        assert.equal(observations.at(-1).requestObserved, sends > before)
        assert.equal(observations.at(-1).confirmationAttempted, sends > before)
      }
    }
    // Reproduce the native editor's distinction: normal element children must
    // contain data-data JSON, while paste inserts through its text model.
    // This fixture does not load B站 code or touch a signed-in browser.
    const multiline = '第一段冻结正文\n\n第二段冻结正文'
    const bodyFixture = `<main><section>
      <input placeholder="好的标题更容易获得支持，选填20字">
      <div contenteditable="true" placeholder="有什么想和大家分享的？" style="white-space:pre-wrap">&#8203;</div>
      </section></main><output id="serialized"></output><output id="error"></output>
      <script>
      (()=>{
      const body=document.querySelector('[contenteditable]');
      body.oninput=()=>{try {
        document.querySelector('#serialized').textContent=[...body.childNodes].map(n=>n.nodeType===3?n.textContent:JSON.parse(n.dataset.data).text).join('');
      } catch { document.querySelector('#error').textContent='native-node-parse-failed'; }};
      body.onpaste=e=>{e.preventDefault();const value=e.clipboardData.getData('Text').trim();body.textContent=value;document.querySelector('#serialized').textContent=value;};
      })();
      </script>`
    for (const mode of [
      'body-fill-regression',
      'body-native-paste',
      'body-existing',
      'body-cancelled',
    ]) {
      await page.setContent(bodyFixture)
      const body = page.locator('[contenteditable]')
      if (mode === 'body-fill-regression') {
        await body.fill(multiline)
        assert.equal(await page.locator('#error').textContent(), 'native-node-parse-failed')
        assert.equal((await readBilibiliComposer(page)).bodyStructureValid, false)
      } else if (mode === 'body-existing') {
        await body.fill('原有正文')
        await assert.rejects(
          pasteBilibiliBody(body, multiline, () => {}),
          /不是空白/u,
        )
        assert.equal(await body.innerText(), '原有正文')
      } else if (mode === 'body-cancelled') {
        await assert.rejects(
          pasteBilibiliBody(body, multiline, () => {
            throw new Error('cancelled')
          }),
        )
        assert.equal(await page.locator('#serialized').textContent(), '')
      } else {
        await pasteBilibiliBody(body, multiline, () => {})
        assert.equal(await page.locator('#serialized').textContent(), multiline)
        assert.equal(await body.innerText(), multiline)
        assert.equal(await page.locator('#error').textContent(), '')
        assert.equal((await readBilibiliComposer(page)).bodyStructureValid, true)
      }
      results.push({ mode, sends: 0, passed: true })
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
