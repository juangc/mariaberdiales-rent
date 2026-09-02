import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { config } from './config.mjs';

function encodeHeader(value) {
  const text = String(value || '').replace(/[\r\n]/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function formatAddress(email, name = '') {
  const address = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error('Configura MAIL_FROM con un correo válido para enviar emails.');
  }
  const displayName = String(name || '').trim();
  return displayName ? `${encodeHeader(displayName)} <${address}>` : address;
}

function messageId() {
  const domain = String(config.mailFrom).split('@')[1] || 'localhost';
  return `<${Date.now().toString(36)}.${crypto.randomBytes(8).toString('hex')}@${domain}>`;
}

function buildMessage({ to, subject, text }) {
  const from = formatAddress(config.mailFrom, 'María Berdiales 10, 2º B');
  return [
    `From: ${from}`,
    `To: ${formatAddress(to.email, to.name)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Message-ID: ${messageId()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
  ].join('\r\n');
}

export function assertEmailReady() {
  formatAddress(config.mailFrom);
  if (config.smtpHost) {
    if (config.smtpUser || config.smtpPassword) {
      if (!config.smtpUser || !config.smtpPassword) throw new Error('Configura SMTP_USER y SMTP_PASSWORD juntos.');
    }
    return;
  }
  if (!config.sendmailPath || !fs.existsSync(config.sendmailPath)) {
    throw new Error(`No se encuentra sendmail en ${config.sendmailPath}. Configura SENDMAIL_PATH o SMTP_HOST.`);
  }
}

function sendWithSendmail(message) {
  assertEmailReady();
  const contents = buildMessage(message);
  return new Promise((resolve, reject) => {
    const child = spawn(config.sendmailPath, ['-t', '-i'], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('El envío del email ha tardado demasiado.'));
    }, 15_000);
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `sendmail terminó con código ${code}.`));
    });
    child.stdin.end(contents);
  });
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const onData = (data) => cleanup(resolve, data);
    const onError = (error) => cleanup(reject, error);
    const cleanup = (callback, value) => {
      socket.off(event, onData);
      socket.off('error', onError);
      callback(value);
    };
    socket.once(event, onData);
    socket.once('error', onError);
  });
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => cleanup(reject, new Error('El servidor SMTP no ha respondido a tiempo.')), 15_000);
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (lines.length && /^\d{3} /.test(lines[lines.length - 1])) cleanup(resolve, buffer);
    };
    const onError = (error) => cleanup(reject, error);
    const cleanup = (callback, value) => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      callback(value);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

async function smtpCommand(socket, command, expected = [250]) {
  socket.write(`${command}\r\n`);
  const response = await smtpRead(socket);
  const code = Number(response.slice(0, 3));
  if (!expected.includes(code)) throw new Error(`Respuesta SMTP inesperada (${code}) al ejecutar ${command.split(' ')[0]}.`);
  return response;
}

async function sendWithSmtp(message) {
  const contents = buildMessage(message);
  const socket = config.smtpSecure
    ? tls.connect({ host: config.smtpHost, port: config.smtpPort, servername: config.smtpHost })
    : net.connect({ host: config.smtpHost, port: config.smtpPort });
  try {
    await once(socket, config.smtpSecure ? 'secureConnect' : 'connect');
    let connection = socket;
    await smtpRead(connection);
    await smtpCommand(connection, 'EHLO maria-berdiales.local');
    if (!config.smtpSecure) {
      await smtpCommand(connection, 'STARTTLS', [220]);
      connection = tls.connect({ socket: connection, servername: config.smtpHost });
      await once(connection, 'secureConnect');
      await smtpCommand(connection, 'EHLO maria-berdiales.local');
    }
    if (config.smtpUser || config.smtpPassword) {
      await smtpCommand(connection, 'AUTH LOGIN', [334]);
      await smtpCommand(connection, Buffer.from(config.smtpUser).toString('base64'), [334]);
      await smtpCommand(connection, Buffer.from(config.smtpPassword).toString('base64'), [235]);
    }
    await smtpCommand(connection, `MAIL FROM:<${config.mailFrom}>`);
    await smtpCommand(connection, `RCPT TO:<${message.to.email}>`, [250, 251]);
    await smtpCommand(connection, 'DATA', [354]);
    connection.write(`${contents.replace(/^\./gm, '..')}\r\n.\r\n`);
    const dataResponse = await smtpRead(connection);
    if (Number(dataResponse.slice(0, 3)) !== 250) throw new Error('El servidor SMTP no aceptó el mensaje.');
    await smtpCommand(connection, 'QUIT', [221]);
  } finally {
    socket.destroy();
  }
}

export function sendEmail(message) {
  assertEmailReady();
  return config.smtpHost ? sendWithSmtp(message) : sendWithSendmail(message);
}

export async function sendWelcomeEmail({ user, temporaryPassword, portalUrl }) {
  await sendEmail({
    to: { email: user.email, name: user.name },
    subject: 'Tu acceso al portal de María Berdiales 10, 2º B',
    text: [
      `Hola ${user.name},`,
      '',
      'Ya tienes acceso al portal privado de María Berdiales 10, 2º B.',
      '',
      `Enlace: ${portalUrl}`,
      `Usuario: ${user.email}`,
      `Contraseña temporal: ${temporaryPassword}`,
      '',
      'Por seguridad, guarda estos datos en un lugar privado. Si necesitas otra contraseña, podemos reenviarte una nueva bienvenida.',
      '',
      'Un saludo,',
      'María Berdiales 10, 2º B',
    ].join('\n'),
  });
}
