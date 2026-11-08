// 工作台位置：位置指针放在 DSH_HOME 外层，数据本身放到用户指定的本地目录。
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { dshHome } from './store.js'

const POINTER = 'media-workbench-location.json'
const LEGACY_ROOT = 'media-desk'

export function defaultWorkspaceDir(env = process.env) {
  return join(dshHome(env), 'media-workbench')
}

export function legacyWorkspaceDir(env = process.env) {
  return join(dshHome(env), LEGACY_ROOT)
}

export function workspacePointer(env = process.env) {
  return join(dshHome(env), POINTER)
}

export function normalizeWorkspaceDir(value, env = process.env) {
  const raw = String(value ?? '').trim()
  if (!raw) return defaultWorkspaceDir(env)
  const expanded = raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw
  if (!isAbsolute(expanded)) throw Object.assign(new Error('工作台路径必须是本地绝对路径，或以 ~/ 开头'), { status: 400 })
  return expanded
}

/** 首次升级时保留旧数据；新用户使用新的目录名。 */
export async function readWorkspaceDir(env = process.env) {
  const pointer = workspacePointer(env)
  try {
    const saved = JSON.parse(await readFile(pointer, 'utf8'))
    if (typeof saved.path === 'string' && saved.path.trim()) return normalizeWorkspaceDir(saved.path, env)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const next = defaultWorkspaceDir(env)
  try {
    await stat(next)
    return next
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const legacy = legacyWorkspaceDir(env)
  try {
    await stat(legacy)
    return legacy
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  return next
}

export async function writeWorkspaceDir(value, env = process.env) {
  const path = normalizeWorkspaceDir(value, env)
  await mkdir(dshHome(env), { recursive: true })
  await writeFile(workspacePointer(env), JSON.stringify({ path }, null, 2), { mode: 0o600 })
  return path
}
