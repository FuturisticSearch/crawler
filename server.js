import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const MAX_RESULTS = 30; // limit to 30 websites

app.get("/search", async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.status(400).json({ error: "Missing query parameter" });

  try {
    // 1️⃣ Query Common Crawl CDX index
    const cdxUrl = `http://index.commoncrawl.org/CC-MAIN-2026-04-index?url=*${encodeURIComponent(q)}*&output=json&limit=${MAX_RESULTS}`;
    const cdxResp = await fetch(cdxUrl);
    if (!cdxResp.ok) throw new Error("CDX query failed");
    const lines = (await cdxResp.text()).split("\n").filter(l => l.trim());
    const cdxResults = lines.map(l => JSON.parse(l));

    const results = [];

    // 2️⃣ Fetch WARC chunks & extract title/snippet
    for (let i = 0; i < cdxResults.length; i++) {
      const r = cdxResults[i];
      const warcUrl = `https://commoncrawl.s3.amazonaws.com/${r.filename}`;

      try {
        const rangeStart = r.offset;
        const rangeEnd = r.offset + r.length;
        const warcResp = await fetch(warcUrl, {
          headers: { "Range": `bytes=${rangeStart}-${rangeEnd}` }
        });
        const warcText = await warcResp.text();

        // Extract title
        const titleMatch = warcText.match(/<title>(.*?)<\/title>/i);
        const title = titleMatch?.[1]?.trim() || r.url;

        // Extract body snippet
        const bodyMatch = warcText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const snippet = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, "").slice(0, 200) : "";

        results.push({
          position: i + 1,
          title,
          link: r.url,
          displayed_link: new URL(r.url).hostname,
          snippet,
        });
      } catch (e) {
        console.log("WARC fetch error:", e.message);
      }
    }

    res.json({
      search_metadata: { query: q, results_returned: results.length, engine: "commoncrawl" },
      organic_results: results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Render sets the port via PORT env variable
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`QikSeek web service running on port ${PORT}`));
