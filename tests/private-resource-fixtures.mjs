// tests/private-resource-fixtures.mjs
// Synthetic shapes from official resource cards; no account data or tracking fields.
const cover = 'https://p1.music.126.net/fixture/shared.jpg'
const wrap = (url1, url2) =>
  `orpheus://open?${new URLSearchParams({ url1, ...(url2 ? { url2 } : {}) })}`
const general = (msg, fields) => ({
  type: 23,
  msg,
  generalMsg: { title: '分享内容', cover, subTitle: '', tag: '', resId: -1, ...fields },
})
export const privateResourceFixtures = [
  general('参加本周音乐活动，分享你的故事。', {
    title: '打开音乐活动',
    webUrl: 'https://music.163.com/g/example-activity?id=100',
  }),
  general('一起来听我的新专辑。', {
    title: '海边专辑',
    subTitle: '示例歌手',
    tag: '专辑',
    webUrl: 'https://music.163.com/',
    nativeUrl: wrap('orpheus://album/700', 'https://music.163.com/#/album?id=700'),
  }),
  general('与你分享新单曲。', {
    title: '海边单曲',
    subTitle: '示例歌手',
    tag: '歌曲',
    nativeUrl: wrap('orpheus://song/701'),
  }),
  general('新歌即将上线，欢迎预约。', {
    title: '未来单曲',
    subTitle: '示例歌手',
    tag: '歌曲',
    nativeUrl: wrap(
      'orpheus://rnpage?component=rn-appointment&resourceType=appointment&resourceId=702',
    ),
  }),
  general('查看你和歌手的回忆。', {
    title: '乐迷档案',
    nativeUrl: wrap('orpheus://rnpage?component=rn-fansgroup&route=home&groupId=703'),
  }),
  general('这条消息没有可用链接。', { title: '静态分享', nativeUrl: 'javascript:alert(1)' }),
]
