import { chromium } from 'playwright-core';

const CDP_PORT = 50404;
const PHONE = '15063036754';

async function main() {
  console.log('🔌 连接到 Electron CDP 端口', CDP_PORT, '...');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);

  const contexts = browser.contexts();
  let page = null;
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      if (p.url().includes('baidu.com')) page = p;
    }
  }
  if (!page) { console.error('❌ 未找到百度页面'); return; }
  console.log(`✅ 使用页面: ${page.url()}`);

  // Step 1: 确保在登录页
  if (!page.url().includes('passport')) {
    await page.goto('https://passport.baidu.com/v2/?login', { waitUntil: 'domcontentloaded', timeout: 15000 });
  }
  await page.waitForTimeout(2000);

  // Step 2: 点击"用户名登录"按钮（从二维码登录切换过去）
  console.log('🔄 点击"用户名登录"...');
  try {
    // 尝试多种方式找到并点击"用户名登录"
    const clicked = await page.evaluate(() => {
      // 查找所有可能包含"用户名登录"的元素
      const all = document.querySelectorAll('a, button, span, div, li, p');
      for (const el of all) {
        const text = el.textContent?.trim();
        if (text === '用户名登录' || text === '帐号密码登录' || text === '密码登录') {
          el.click();
          return `点击了: "${text}" (${el.tagName})`;
        }
      }
      return '未找到用户名登录按钮';
    });
    console.log(`  ${clicked}`);
  } catch (e) {
    console.log(`  evaluate 错误: ${e.message?.slice(0, 80)}`);
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/baidu-step2.png' });
  console.log('📸 截图 step2 已保存');

  // Step 3: 查看当前页面所有 input 和可点击元素
  const pageInfo = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].map(i =>
      `name=${i.name}, id=${i.id}, type=${i.type}, placeholder="${i.placeholder}", visible=${i.offsetParent !== null}`
    );
    const clickables = [...document.querySelectorAll('a, button')].filter(e => e.offsetParent !== null).map(e =>
      `"${e.textContent?.trim()?.slice(0, 30)}" (${e.tagName}.${e.className?.slice(0, 30)})`
    ).slice(0, 20);
    return { inputs, clickables };
  });
  console.log('📋 可见 inputs:', JSON.stringify(pageInfo.inputs, null, 2));
  console.log('📋 可见按钮/链接:', JSON.stringify(pageInfo.clickables, null, 2));

  // Step 4: 尝试输入手机号
  console.log(`📝 输入手机号: ${PHONE}...`);
  const fillResult = await page.evaluate((phone) => {
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      if (input.offsetParent === null) continue; // 跳过隐藏元素
      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      const placeholder = (input.placeholder || '').toLowerCase();
      if (name.includes('user') || name.includes('phone') || name.includes('account') ||
          id.includes('user') || id.includes('phone') || id.includes('account') ||
          placeholder.includes('手机') || placeholder.includes('请输入') || placeholder.includes('帐号') ||
          input.type === 'tel' || (input.type === 'text' && input.offsetParent !== null)) {
        // 使用 native input setter
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        nativeInputValueSetter?.call(input, phone);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return `✅ 填入了: name=${input.name}, id=${input.id}, type=${input.type}, value=${input.value}`;
      }
    }
    return '❌ 未找到可见的输入框';
  }, PHONE);
  console.log(fillResult);

  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/baidu-step3.png' });
  console.log('📸 截图 step3 已保存');

  // Step 5: 查找并点击短信验证码/获取验证码
  console.log('📩 查找"获取验证码"或切换到短信登录...');
  const smsResult = await page.evaluate(() => {
    const all = document.querySelectorAll('a, button, span, div, li, p, input');
    const results = [];
    for (const el of all) {
      const text = el.textContent?.trim();
      if (text && (text.includes('短信') || text.includes('验证码') || text.includes('获取'))) {
        results.push(`"${text.slice(0, 40)}" (${el.tagName}.${el.className?.slice(0, 20)})`);
        if (text.includes('短信登录') || text.includes('短信快捷')) {
          el.click();
          results.push('  -> 已点击');
        }
      }
    }
    return results;
  });
  console.log('📋 短信相关元素:', smsResult);

  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/baidu-step4.png' });
  console.log('📸 截图 step4 已保存');

  // 再次尝试点击获取验证码
  const codeResult = await page.evaluate(() => {
    const all = document.querySelectorAll('a, button, span, div, input[type="button"]');
    for (const el of all) {
      const text = el.textContent?.trim();
      if (text === '获取验证码' || text === '获取短信验证码' || text === '发送验证码') {
        el.click();
        return `✅ 点击了: "${text}"`;
      }
    }
    // 列出所有可见按钮
    const visible = [...all].filter(e => e.offsetParent !== null).map(e =>
      `"${e.textContent?.trim()?.slice(0, 30)}"`
    ).slice(0, 15);
    return '未找到获取验证码按钮。可见按钮: ' + visible.join(', ');
  });
  console.log('📋 获取验证码:', codeResult);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/baidu-step5.png' });
  console.log('📸 截图 step5 已保存');

  console.log('\n==========================================');
  console.log('⏳ 请查看 CCLink Studio 应用中的百度登录页面');
  console.log('📱 如需短信验证码，请检查手机');
  console.log('==========================================');

  await browser.close();
}

main().catch(err => {
  console.error('❌ 错误:', err.message?.slice(0, 200));
  process.exit(1);
});
