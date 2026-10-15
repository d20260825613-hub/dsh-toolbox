// Mimic Chatbox's BingSearch provider exactly (renderer code path).
const q = process.argv[2] || '今天的新闻';
const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
const res = await fetch(url, {
  method: 'GET',
  headers: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-Hans,zh;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  redirect: 'follow',
});
const html = await res.text();
console.log('status', res.status, 'final url', res.url, 'bytes', html.length);
// Chatbox parses '#b_results>li.b_algo' via DOMParser; approximate here with regex on b_algo blocks.
const blocks = html.match(/<li class="b_algo[\s\S]*?(?=<li class="b_algo|<\/ol>|$)/g) || [];
console.log('b_algo blocks:', blocks.length);
const items = [];
for (const b of blocks.slice(0, 10)) {
  const m = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
  if (!m) continue;
  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  items.push({ title: strip(m[2]), link: m[1] });
}
console.log(JSON.stringify(items.slice(0, 5), null, 2));
