/* 一键启动：起服务器 + 打开圣诞树页面。由 start.cmd 调用，也可直接 node launcher.mjs [端口] */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = process.argv[2] || '8080';
const URL = `http://127.0.0.1:${PORT}/`;

console.log('');
console.log('  === 圣诞之夜 · 3D 粒子圣诞树 ===');
console.log('');
console.log(`  正在点亮圣诞树： ${URL}`);
console.log('');

// 1) 起服务器（独立进程，关闭本窗口也不影响）
const server = spawn(process.execPath, [join(ROOT, 'server.js'), PORT], {
  cwd: ROOT,
  detached: true,
  stdio: 'ignore',
});
server.unref();

// 2) 等服务器就绪（最多 10 秒）
let ready = false;
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(500) });
    if (r.ok) { ready = true; break; }
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

if (!ready) {
  console.log('  [错误] 服务器启动失败。请手动运行： node server.js ' + PORT);
  process.exit(1);
}

// 3) 用系统默认浏览器打开（用户机器上即 Edge）。explorer.exe 会按注册表里的默认关联打开 URL，
//    比硬编码浏览器路径更可靠，也符合「默认浏览器」的预期。
spawn('explorer.exe', [URL], { detached: true, stdio: 'ignore' }).unref();

console.log('  浏览器已打开：' + URL);
console.log('');
console.log('  如果没看到圣诞树，在浏览器地址栏手动输入上面的网址即可。');
console.log('  关闭服务器：打开任务管理器结束 node.exe，或关掉“node server.js”窗口。');
console.log('');
