const fs = require('fs');
const tty = require('tty');
const readline = require('readline');

const ESC = '\x1b';
const CSI = ESC + '[';
const HIDE_CURSOR = CSI + '?25l';
const SHOW_CURSOR = CSI + '?25h';
const CLEAR_LINE = CSI + '2K\r';

function openTty() {
  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'r+');
  } catch (err) {
    throw new Error('claude-init needs an interactive terminal (no /dev/tty available)');
  }
  const input = new tty.ReadStream(fd);
  const output = new tty.WriteStream(fd);
  return { fd, input, output };
}

function withTty(fn) {
  const t = openTty();
  const cleanup = () => {
    try { t.input.setRawMode(false); } catch {}
    try { t.output.write(SHOW_CURSOR); } catch {}
    try { t.input.destroy(); } catch {}
    try { t.output.destroy(); } catch {}
    try { fs.closeSync(t.fd); } catch {}
  };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  return Promise.resolve()
    .then(() => fn(t))
    .finally(cleanup);
}

function styleDim(s) { return `\x1b[2m${s}\x1b[22m`; }
function styleBold(s) { return `\x1b[1m${s}\x1b[22m`; }
function styleCyan(s) { return `\x1b[36m${s}\x1b[39m`; }
function styleGreen(s) { return `\x1b[32m${s}\x1b[39m`; }

async function checkbox({ message, choices, hint }) {
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const items = choices.map((c) => ({
    name: c.name,
    value: c.value !== undefined ? c.value : c.name,
    description: c.description || '',
    checked: !!c.checked,
    disabled: !!c.disabled,
  }));
  return withTty(async ({ input, output }) => {
    input.setRawMode(true);
    readline.emitKeypressEvents(input);
    output.write(HIDE_CURSOR);
    let cursor = items.findIndex((i) => !i.disabled);
    if (cursor < 0) cursor = 0;
    let firstRender = true;
    const headerLines = 2;

    const render = () => {
      if (!firstRender) {
        const totalLines = headerLines + items.length;
        output.write(CSI + totalLines + 'A');
      }
      firstRender = false;
      output.write(CLEAR_LINE + styleBold('? ') + message + '\n');
      output.write(CLEAR_LINE + styleDim(hint || '↑/↓ move · space toggle · a toggle all · enter confirm · q cancel') + '\n');
      items.forEach((item, idx) => {
        const isCursor = idx === cursor;
        const box = item.checked ? styleGreen('[x]') : '[ ]';
        const pointer = isCursor ? styleCyan('›') : ' ';
        const disabledMark = item.disabled ? styleDim(' (disabled)') : '';
        const desc = item.description ? styleDim('  — ' + item.description) : '';
        const line = `${pointer} ${box} ${item.name}${disabledMark}${desc}`;
        output.write(CLEAR_LINE + (isCursor ? styleBold(line) : line) + '\n');
      });
    };

    render();

    return new Promise((resolve, reject) => {
      const onKey = (_str, key) => {
        if (!key) return;
        if (key.ctrl && key.name === 'c') return finish(reject, new Error('cancelled'));
        if (key.name === 'q' || key.name === 'escape') return finish(reject, new Error('cancelled'));
        if (key.name === 'return') {
          return finish(resolve, items.filter((i) => i.checked).map((i) => i.value));
        }
        if (key.name === 'up' || (key.name === 'k' && !key.shift)) {
          do { cursor = (cursor - 1 + items.length) % items.length; }
          while (items[cursor].disabled);
          render();
          return;
        }
        if (key.name === 'down' || (key.name === 'j' && !key.shift)) {
          do { cursor = (cursor + 1) % items.length; }
          while (items[cursor].disabled);
          render();
          return;
        }
        if (key.name === 'space') {
          if (!items[cursor].disabled) {
            items[cursor].checked = !items[cursor].checked;
            render();
          }
          return;
        }
        if (key.name === 'a') {
          const allOn = items.filter((i) => !i.disabled).every((i) => i.checked);
          items.forEach((i) => { if (!i.disabled) i.checked = !allOn; });
          render();
          return;
        }
      };
      function finish(cb, val) {
        input.removeListener('keypress', onKey);
        cb(val);
      }
      input.on('keypress', onKey);
    });
  });
}

async function confirm({ message, default: def = true }) {
  return withTty(async ({ input, output }) => {
    input.setRawMode(true);
    readline.emitKeypressEvents(input);
    const yn = def ? 'Y/n' : 'y/N';
    output.write(styleBold('? ') + message + ' ' + styleDim('(' + yn + ') '));
    return new Promise((resolve, reject) => {
      const onKey = (_str, key) => {
        if (!key) return;
        if (key.ctrl && key.name === 'c') { input.removeListener('keypress', onKey); output.write('\n'); return reject(new Error('cancelled')); }
        if (key.name === 'return') { input.removeListener('keypress', onKey); output.write((def ? 'yes' : 'no') + '\n'); return resolve(def); }
        if (key.name === 'y') { input.removeListener('keypress', onKey); output.write('yes\n'); return resolve(true); }
        if (key.name === 'n') { input.removeListener('keypress', onKey); output.write('no\n'); return resolve(false); }
      };
      input.on('keypress', onKey);
    });
  });
}

async function input({ message, default: def = '', validate }) {
  return withTty(async ({ input: ttyIn, output }) => {
    const rl = readline.createInterface({ input: ttyIn, output, terminal: true });
    const prompt = styleBold('? ') + message + (def ? styleDim(' (' + def + ') ') : ' ');
    return new Promise((resolve, reject) => {
      rl.question(prompt, (answer) => {
        rl.close();
        const value = answer.trim() === '' ? def : answer;
        if (validate) {
          const result = validate(value);
          if (result !== true) return reject(new Error(typeof result === 'string' ? result : 'invalid input'));
        }
        resolve(value);
      });
      rl.on('SIGINT', () => { rl.close(); reject(new Error('cancelled')); });
    });
  });
}

async function password({ message }) {
  return withTty(async ({ input: ttyIn, output }) => {
    output.write(styleBold('? ') + message + ' ');
    ttyIn.setRawMode(true);
    let buf = '';
    return new Promise((resolve, reject) => {
      const onData = (chunk) => {
        const s = chunk.toString('utf8');
        for (const ch of s) {
          if (ch === '\r' || ch === '\n') {
            ttyIn.removeListener('data', onData);
            output.write('\n');
            return resolve(buf);
          }
          if (ch === '\x03') {
            ttyIn.removeListener('data', onData);
            output.write('\n');
            return reject(new Error('cancelled'));
          }
          if (ch === '\x7f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
          buf += ch;
        }
      };
      ttyIn.on('data', onData);
    });
  });
}

async function select({ message, choices, hint }) {
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('select: empty choices');
  const items = choices.map((c) => ({
    name: c.name,
    value: c.value !== undefined ? c.value : c.name,
    description: c.description || '',
    disabled: !!c.disabled,
  }));
  return withTty(async ({ input, output }) => {
    input.setRawMode(true);
    readline.emitKeypressEvents(input);
    output.write(HIDE_CURSOR);
    let cursor = items.findIndex((i) => !i.disabled);
    if (cursor < 0) cursor = 0;
    let firstRender = true;
    const headerLines = 2;
    const render = () => {
      if (!firstRender) {
        output.write(CSI + (headerLines + items.length) + 'A');
      }
      firstRender = false;
      output.write(CLEAR_LINE + styleBold('? ') + message + '\n');
      output.write(CLEAR_LINE + styleDim(hint || '↑/↓ move · enter confirm · q cancel') + '\n');
      items.forEach((item, idx) => {
        const isCursor = idx === cursor;
        const pointer = isCursor ? styleCyan('›') : ' ';
        const disabledMark = item.disabled ? styleDim(' (disabled)') : '';
        const desc = item.description ? styleDim('  — ' + item.description) : '';
        const line = `${pointer} ${item.name}${disabledMark}${desc}`;
        output.write(CLEAR_LINE + (isCursor ? styleBold(line) : line) + '\n');
      });
    };
    render();
    return new Promise((resolve, reject) => {
      const onKey = (_str, key) => {
        if (!key) return;
        if (key.ctrl && key.name === 'c') { input.removeListener('keypress', onKey); return reject(new Error('cancelled')); }
        if (key.name === 'q' || key.name === 'escape') { input.removeListener('keypress', onKey); return reject(new Error('cancelled')); }
        if (key.name === 'return') { input.removeListener('keypress', onKey); return resolve(items[cursor].value); }
        if (key.name === 'up' || key.name === 'k') {
          do { cursor = (cursor - 1 + items.length) % items.length; } while (items[cursor].disabled);
          render();
        } else if (key.name === 'down' || key.name === 'j') {
          do { cursor = (cursor + 1) % items.length; } while (items[cursor].disabled);
          render();
        }
      };
      input.on('keypress', onKey);
    });
  });
}

module.exports = { checkbox, select, confirm, input, password };
