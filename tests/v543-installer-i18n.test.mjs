import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const source = fs.readFileSync(new URL('../install.mjs', import.meta.url), 'utf8');
const raw = fs.readFileSync(new URL('../core/i18n.json', import.meta.url), 'utf8');
const dict = JSON.parse(raw);
const addedKeys = ["Your Plan", "You are subscribed to the best Google AI plan.", "Authenticated via Enterprise Gateway", "Managed by Enterprise Gateway", "Invite a Friend", "Select your license", "Your quota for this model is running low.", "Validation timed out.", "Pin / Unpin Conversation", "No conversations found", "Toggle Word Wrap", "Enter always submits. This adds a second shortcut.", "Ask a quick question without interrupting the main conversation.", "Install or enable the Google Drive plugin in Customizations to search files with @drive: or paste Drive links", "Enter the configuration values this MCP server needs. Saving restarts the server with them.", "Set up authentication", "Go to Accounts", "View MCP servers", "Search Google Drive", "Upload Files", "Last 7 days", "Show Details", "Remove from Recent", "Open on phone", "Pick up this remote conversation on your phone or in any browser. Scan the QR code or open the link below.", "Runs remotely", "Current workspace", "Run in your current workspace", "Resume it to open a new terminal. Anything that was running in this one has stopped.", "Resume it to load this file.", "See more results", "Loading apps...", "Getting scripts...", "Switch Roles", "Main Agent", "Complete verification", "Log back in", "Why are you opting out of auto-triggered Best-of-N?", "Too many surveys", "The current trigger rate is too high.", "Prompt too simple", "This prompt is straightforward and does not need alternative comparisons.", "In a rush", "I prefer an immediate single response to prioritize productivity right now.", "(Optional) Tell us more or type your reason...", "Don't show this for 2 days", "Please list the steps to reproduce the issue", "Send feedback as", "Type absolute path or navigate folders...", "What should the agent do on each run? For example: summarize new bugs assigned to me and anything that changed overnight."];
const v550Keys = ["System UI", "Appears larger on mobile", "Did restarting the desktop app help?", "Browser is currently being operated by this conversation in another Hub window", "Choose what to clear from the built-in browser. It can't be undone.", "Couldn't clear browsing data. Try again.", "No sites have cookies in the built-in browser.", "Error: Artifacts from remote conversations are not available here.", "Add bundle", "Remove bundle", "Loading bundles...", "No bundles available.", "Review bundle before adding", "Review contents", "Curated sets of plugins for common workflows and roles.", "Disabling or removing this bundle doesn't affect it.", "Installed separately", "Add anyway", "Browsing Data", "Visited URLs and autocomplete suggestions.", "Cookies and other site data", "Cookies by Site", "Sites with cookies", "Search sites", "Search sites...", "Cleared built-in browser data", "Cleared built-in browser history", "Couldn't load cookies.", "Enable Browser Agent", "Browser screenshot", "Open browser screenshot", "No browser steps recorded", "Keybinding Scheme", "Customize Shortcuts", "Antigravity (AGY) Style", "VS Code Default", "VS Code Keyboard Shortcuts", "Manage your keybinding scheme and customize shortcuts in VS Code.", "Managed by application menu", "Insert into main conversation", "Side Question Selection", "Unarchive the main conversation to insert", "The main conversation's input isn't available right now.", "This side question isn't available in this conversation.", "Interrupt Agent", "Waiting for subagent", "Response actions", "Open in settings", "Always open", "System default app", "Access restricted", "Checking access...", "Stop transcription", "Voice dictation unavailable", "Microphone problem", "Microphone silent", "Microphone capture failed.", "Microphone capture ended unexpectedly.", "Microphone capture is not supported in this environment.", "Microphone is already in use by another recording session.", "Toggle Virtual Machine", "Setup Script", "Saved setup routine", "Saving setup routine", "Deleted setup routine", "Deleting setup routine", "Canceled saving setup routine", "Canceled deletion of setup routine", "Compare then and now", "In review"];
test('v543 dictionary adds all 50 UI labels without changing 1756 fusion translations', () => {
  assert.equal(Object.keys(dict).length,1876);
  for(const key of addedKeys) assert.equal(typeof dict[key],'string',key);
  const prior = Object.fromEntries(Object.entries(dict).filter(([k])=>!addedKeys.includes(k) && !v550Keys.includes(k)));
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(prior)).digest('hex'),
    "c36b4d6d27f79471b3b3fe5fb8bd08e424867b9e0904a61eca3d2b186a33f82a");
});
test('v543 dictionary has no duplicate keys or case/curly-apostrophe aliases', () => {
  const keys = [...raw.matchAll(/^  ("(?:[^"\\]|\\.)*"):/gm)].map(m=>JSON.parse(m[1]));
  assert.equal(keys.length,1876);
  assert.equal(new Set(keys).size,keys.length);
  assert.equal(new Set(keys.map(k=>k.toLowerCase().replace(/[‘’]/g,"'"))).size,keys.length);
});
test('v543 new labels retain configuration restart, low quota and remote scope meanings', () => {
  assert.match(dict['Enter the configuration values this MCP server needs. Saving restarts the server with them.'], /保存后.*新配置.*重启/);
  assert.match(dict['Your quota for this model is running low.'], /该模型.*配额.*即将耗尽/);
  assert.equal(dict['Runs remotely'],'远程运行');
  assert.match(dict['Ask a quick question without interrupting the main conversation.'], /不打断主对话/);
  assert.match(dict['Resume it to open a new terminal. Anything that was running in this one has stopped.'], /新终端.*原终端.*已停止/);
});
function evaluateDiagnostic({pills=[], primary=null, host=true}={}) {
  const start = source.indexOf('async function inspectLiveWindow(');
  const expression = source.slice(start).match(/expression: `([\s\S]*?)`,\s*returnByValue/)[1];
  const document = {
    querySelectorAll(selector) { assert.equal(selector,'[data-ag-metrics-pill="1"], #ag-live-metrics-pill'); return pills; },
    querySelector() { return null; },
    getElementById(id) { return id==='ag-live-metrics-pill' ? primary : null; },
    documentElement: {getAttribute() {return null;}}
  };
  return vm.runInNewContext(expression,{document,window:{location:{protocol:host?'vscode-file:':'https:'}}});
}
test('v543 diagnostics count every composer while keeping focused legacy primary text', () => {
  const left={textContent:'left'},right={textContent:'right'},third={textContent:'third'};
  const result=evaluateDiagnostic({pills:[left,right,third],primary:right});
  assert.equal(result.pillCount,3); assert.equal(result.pillMounted,true); assert.equal(result.pillText,'right');
});
test('v543 diagnostics fall back to first scoped pill when legacy ID is temporarily absent', () => {
  const result=evaluateDiagnostic({pills:[{textContent:'scoped'}]});
  assert.equal(result.pillCount,1); assert.equal(result.pillText,'scoped');
});
test('v543 diagnostics report absent pills and retain nonhost classification', () => {
  const result=evaluateDiagnostic({host:false});
  assert.equal(result.pillCount,0); assert.equal(result.pillMounted,false); assert.equal(result.pillText,null); assert.equal(result.__isHost,false);
});
test('v543 installer records fusion version and never restores sync-user', () => {
  assert.match(source,/version: '5\.5\.2-eric\.1'/);
  assert.doesNotMatch(source,/hasFlag\(['"]--sync-user/);
});
