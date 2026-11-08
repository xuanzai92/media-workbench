// 海外平台：链接识别和 RedFox 返回字段整理。
import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchAccount, parseAccountUrl } from '../src/redfox.js'

test('海外主页链接：TikTok、Instagram、X 认得出，帖子页和功能页不当成账号', () => {
  assert.deepEqual(parseAccountUrl('https://www.tiktok.com/@tiktok?lang=en'), { platform: 'TikTok', id: 'tiktok', handle: 'tiktok', url: 'https://www.tiktok.com/@tiktok' })
  assert.deepEqual(parseAccountUrl('https://www.instagram.com/instagram/'), { platform: 'Instagram', id: 'instagram', username: 'instagram', url: 'https://www.instagram.com/instagram/' })
  assert.equal(parseAccountUrl('https://twitter.com/X').platform, 'X')
  assert.equal(parseAccountUrl('https://x.com/elonmusk').id, 'elonmusk')
  for (const bad of ['https://www.instagram.com/p/DfQCqMnhpsG/', 'https://www.instagram.com/explore/', 'https://x.com/home', 'https://x.com/i/status/1', 'https://www.tiktok.com/foryou', 'https://x.com/a/status/2']) {
    assert.equal(parseAccountUrl(bad), null, bad)
  }
})

test('RedFox：海外接口统一成作品和资料字段', async () => {
  const calls = []
  const client = { request: async (path, body) => {
    calls.push([path, body])
    if (path.endsWith('/userInfo')) return { fullName: 'Instagram', biography: 'Your next discovery', followerCount: 9, profilePicUrl: 'https://cdn.example/avatar.jpg' }
    if (path.endsWith('/search')) return { items: [{ code: 'abcdef', takenAt: 1793647575, likeCount: 1, captionText: 'hi', user: { username: 'instagram' }, imageUrl: 'https://cdn.example/a.jpg' }] }
    throw new Error(path)
  } }
  const ig = await fetchAccount({ platform: 'Instagram', id: 'instagram' }, client)
  assert.equal(ig.profile.nickname, 'Instagram')
  assert.equal(ig.profile.followers, 9)
  assert.equal(ig.posts[0].url, 'https://www.instagram.com/p/abcdef/')
  assert.equal(ig.posts[0].likes, 1)
  assert.deepEqual(calls.map(row => row[0]), ['/story/api/ins/userInfo', '/story/api/ins/search'])
})

test('RedFox：X 时间线一次调用整理成统一字段', async () => {
  const client = { request: async (path) => {
    if (path.endsWith('/userInfo')) return { displayName: 'X', description: 'what\'s happening?!', followers: 5, username: 'X' }
    if (path.endsWith('/userTimeline')) return { timeline: [{ tweetId: '1', createdAt: 'Mon Nov 02 21:57:53 +0000 2026', text: 'hello', likeCount: 2, retweetCount: 3 }] }
    throw new Error(path)
  } }
  const x = await fetchAccount({ platform: 'X', id: 'X' }, client)
  assert.equal(x.profile.followers, 5)
  assert.equal(x.posts[0].url, 'https://x.com/X/status/1')
  assert.equal(x.posts[0].shares, 3)
})
