// STAGING ONLY. Railway gives a service a single *.up.railway.app domain, but the
// app serves two sites told apart by the domain (src/lib/site.ts). This tiny proxy
// is a second staging service with its own domain: it forwards every request to
// the app over the private network, keeping its own Host header, so the app sees
// the PPP_ORIGIN host and serves the PPP site. Production uses ppp.51vo.nl instead.
const http = require("http");

const TARGET_HOST = process.env.TARGET_HOST ?? "snack-system.railway.internal";
const TARGET_PORT = Number(process.env.TARGET_PORT ?? 8080);

http
  .createServer((req, res) => {
    if (req.url === "/__proxy_health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    const upstream = http.request(
      {
        host: TARGET_HOST,
        port: TARGET_PORT,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, "x-forwarded-proto": "https" },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      }
    );
    upstream.on("error", (err) => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`Proxy error: ${err.message}`);
    });
    req.pipe(upstream);
  })
  .listen(Number(process.env.PORT ?? 8080), () => console.log("staging PPP proxy up"));
