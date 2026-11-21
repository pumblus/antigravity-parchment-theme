import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const raw = fs.readFileSync(new URL('../core/i18n.json', import.meta.url), 'utf8');
const dict = JSON.parse(raw);
const newKeys = ["System UI", "Appears larger on mobile", "Did restarting the desktop app help?", "Browser is currently being operated by this conversation in another Hub window", "Choose what to clear from the built-in browser. It can't be undone.", "Couldn't clear browsing data. Try again.", "No sites have cookies in the built-in browser.", "Error: Artifacts from remote conversations are not available here.", "Add bundle", "Remove bundle", "Loading bundles...", "No bundles available.", "Review bundle before adding", "Review contents", "Curated sets of plugins for common workflows and roles.", "Disabling or removing this bundle doesn't affect it.", "Installed separately", "Add anyway", "Browsing Data", "Visited URLs and autocomplete suggestions.", "Cookies and other site data", "Cookies by Site", "Sites with cookies", "Search sites", "Search sites...", "Cleared built-in browser data", "Cleared built-in browser history", "Couldn't load cookies.", "Enable Browser Agent", "Browser screenshot", "Open browser screenshot", "No browser steps recorded", "Keybinding Scheme", "Customize Shortcuts", "Antigravity (AGY) Style", "VS Code Default", "VS Code Keyboard Shortcuts", "Manage your keybinding scheme and customize shortcuts in VS Code.", "Managed by application menu", "Insert into main conversation", "Side Question Selection", "Unarchive the main conversation to insert", "The main conversation's input isn't available right now.", "This side question isn't available in this conversation.", "Interrupt Agent", "Waiting for subagent", "Response actions", "Open in settings", "Always open", "System default app", "Access restricted", "Checking access...", "Stop transcription", "Voice dictation unavailable", "Microphone problem", "Microphone silent", "Microphone capture failed.", "Microphone capture ended unexpectedly.", "Microphone capture is not supported in this environment.", "Microphone is already in use by another recording session.", "Toggle Virtual Machine", "Setup Script", "Saved setup routine", "Saving setup routine", "Deleted setup routine", "Deleting setup routine", "Canceled saving setup routine", "Canceled deletion of setup routine", "Compare then and now", "In review"];
test('v550 adds 70 labels and preserves all 1806 existing translations verbatim', () => {
 assert.equal(Object.keys(dict).length,1876);
 for(const key of newKeys) assert.equal(typeof dict[key],'string',key);
 const baseline=Object.fromEntries(Object.entries(dict).filter(([key])=>!newKeys.includes(key)));
 assert.equal(Object.keys(baseline).length,1806);
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(baseline)).digest('hex'),'ba4d8a6512d1ce67243e15be4fa90296add61a92f04c5918f853abfb2de2fb6c');
});
test('v550 dictionary has no literal or normalized duplicate aliases', () => {
 const keys = [...raw.matchAll(/^  ("(?:[^"\\]|\\.)*"):/gm)].map(m=>JSON.parse(m[1]));
 assert.equal(keys.length,1876);
 assert.equal(new Set(keys).size,keys.length);
 assert.equal(new Set(keys.map(k=>k.toLowerCase().replace(/[‘’]/g,"'"))).size,keys.length);
});
test('v550 retains irreversible browser-clear warning and failed action wording', () => {
 assert.match(dict["Choose what to clear from the built-in browser. It can't be undone."],/内置浏览器.*无法撤销/);
 assert.match(dict["Couldn't clear browsing data. Try again."],/无法清除.*重试/);
 assert.match(dict['Cleared built-in browser data'],/^已清除/);
 assert.match(dict['Access restricted'],/受限/);
 assert.match(dict['Checking access...'],/正在检查/);
});
test('v550 distinguishes microphone unsupported, busy, silent and ended states', () => {
 assert.match(dict['Microphone capture is not supported in this environment.'],/当前环境不支持/);
 assert.match(dict['Microphone is already in use by another recording session.'],/另一个录音会话占用/);
 assert.match(dict['Microphone silent'],/未检测到.*声音/);
 assert.match(dict['Microphone capture ended unexpectedly.'],/意外中断/);
});
test('v550 setup routine statuses preserve pending, finished and canceled distinctions', () => {
 assert.match(dict['Saving setup routine'],/^正在保存/);
 assert.match(dict['Saved setup routine'],/^已保存/);
 assert.match(dict['Deleting setup routine'],/^正在删除/);
 assert.match(dict['Deleted setup routine'],/^已删除/);
 assert.match(dict['Canceled saving setup routine'],/^已取消保存/);
 assert.match(dict['Canceled deletion of setup routine'],/^已取消删除/);
});
test('v550 bundle and auxiliary conversation labels preserve independent install and unarchive constraints', () => {
 assert.equal(dict['Installed separately'],'已单独安装');
 assert.match(dict["Disabling or removing this bundle doesn't affect it."],/禁用或移除.*不会/);
 assert.match(dict['Unarchive the main conversation to insert'],/取消归档主对话.*插入/);
 assert.match(dict["The main conversation's input isn't available right now."],/主对话输入框当前不可用/);
});
