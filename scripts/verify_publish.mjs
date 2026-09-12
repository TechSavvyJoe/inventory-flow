const base = process.env.INVENTORY_OPS_CLOUD_URL
const res = await fetch(new URL('/internal/status', base), {
  headers: {
    'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    'Authorization': `Bearer ${process.env.INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN}`,
  },
})
const body = await res.json()
console.log(JSON.stringify({ httpStatus: res.status, ready: body.ready, reportDate: body.reportDate, bundleSha256Present: !!body.bundleSha256 }, null, 2))
