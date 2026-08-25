/**
 * Smoke test — exercises every client method directly.
 * Run:  MB_PROXY=http://user:pass@host:port tsx src/test.ts
 */
import * as mb from "./client.js";

const MENTALIST_ID = "7845473610491125400";

async function run() {
  let pass = 0, fail = 0;

  async function test(name: string, fn: () => Promise<unknown>) {
    try {
      const data = await fn();
      const preview = JSON.stringify(data).slice(0, 120);
      console.log(`  ✅ ${name}\n     ${preview}`);
      pass++;
    } catch (e: unknown) {
      console.log(`  ❌ ${name}\n     ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      fail++;
    }
  }

  console.log("\n── MovieBox API smoke test ──────────────────────────────────────\n");

  await test("search('inception')",           () => mb.search("inception", 1, 3));
  await test("getSeasonInfo(Mentalist)",       () => mb.getSeasonInfo(MENTALIST_ID));
  await test("getSubject(Mentalist, se=1)",    () => mb.getSubject(MENTALIST_ID, 1));
  await test("getResources(Mentalist, se=1)",  () => mb.getResources(MENTALIST_ID, 1, 1, 5));
  await test("getPlayInfo(Mentalist, s1e1)",   () => mb.getPlayInfo(MENTALIST_ID, 1, 1));
  await test("getTrending()",                  () => mb.getTrending());
  await test("getCommunityTrending()",         () => mb.getCommunityTrending());
  await test("getDailyRec()",                  () => mb.getDailyRec(1, 3));
  await test("getRelated(Mentalist)",          () => mb.getRelated(MENTALIST_ID, 1, 3));
  await test("getDubInfo(Mentalist)",          () => mb.getDubInfo(MENTALIST_ID));
  await test("getBottomTabs()",                () => mb.getBottomTabs());
  await test("getPostCount(Mentalist)",        () => mb.getPostCount(MENTALIST_ID));

  console.log(`\n── Results: ${pass} passed, ${fail} failed ──────────────────────────\n`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
