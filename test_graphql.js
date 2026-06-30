const axios = require('axios');
const fs = require('fs');

async function test() {
  const cookie = fs.readFileSync('./cookies/cookies.txt', 'utf-8');
  let cookieHeader = '';
  cookie.split('\n').forEach(line => {
      if (!line.startsWith('#') && line.trim() !== '') {
          const parts = line.split('\t');
          if (parts.length >= 7) {
              cookieHeader += `${parts[5]}=${parts[6].trim()}; `;
          }
      }
  });

  try {
    const res = await axios.get('https://www.instagram.com/graphql/query/', {
      params: {
        query_hash: 'b3055c01b4b222b8a47dc12b090e4e64',
        variables: JSON.stringify({ shortcode: 'DaKo9IdjAPb' }),
      },
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      }
    });
    console.log("SUCCESS!");
    fs.writeFileSync('graphql_out.json', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error("ERROR:", e.response ? e.response.status : e.message);
  }
}
test();
