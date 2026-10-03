import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import {
  TOPIC_WINDOW_DAYS,
  annotateTopics,
  buildTopicsPrompt,
  parseTopics,
  pickFreshTopic,
  topicOverlap,
} from "./topics";
import type { BlogSettings, RecentPost } from "./types";

const NOW = new Date("2026-06-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** A post published `daysAgo` days before NOW (negative = scheduled in the future). */
function post(title: string, tags: string[], daysAgo: number): RecentPost {
  return { title, tags, publishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString() };
}

describe("TOPIC_WINDOW_DAYS", () => {
  it("is 60", () => {
    expect(TOPIC_WINDOW_DAYS).toBe(60);
  });
});

describe("topicOverlap: lexical rule", () => {
  const recent = [post("How to price a handmade candle for retail sales", [], 30)];

  it("flags a candidate sharing most keywords with a recent title", () => {
    const reason = topicOverlap("Pricing handmade candles for retail", recent, NOW);
    expect(reason).toMatch(/How to price a handmade candle/);
    expect(reason).toMatch(/shared keywords/);
  });

  it("stems plurals and common suffixes so variants still match", () => {
    expect(topicOverlap("Prices of handmade candles at retail", recent, NOW)).not.toBeNull();
  });

  it("accepts a candidate on a different subject", () => {
    expect(topicOverlap("Winter storage tips for garden furniture", recent, NOW)).toBeNull();
  });

  it("needs at least 3 shared keywords", () => {
    const posts = [post("Alpha bravo", [], 5)];
    expect(topicOverlap("Alpha bravo", posts, NOW)).toBeNull();
    expect(topicOverlap("Alpha bravo charlie", [post("Alpha bravo charlie", [], 5)], NOW)).not.toBeNull();
  });

  it("needs a Jaccard similarity of at least 0.25", () => {
    const recentTitle = "alpha bravo charlie november oscar papa quebec romeo sierra tango uniform victor";
    const candidate = "alpha bravo charlie delta echoes foxtrot golfer hotel india juliet kilo limas";
    // 3 shared keywords, but 3 / 21 of the vocabulary: not an overlap
    expect(topicOverlap(candidate, [post(recentTitle, [], 5)], NOW)).toBeNull();
    // same 3 shared keywords in much shorter titles: overlap
    expect(topicOverlap("alpha bravo charlie delta", [post("alpha bravo charlie november", [], 5)], NOW)).not.toBeNull();
  });

  it("ignores stopwords, numbers and short words", () => {
    const posts = [post("The best tips and ways to know what you need in 2026", [], 5)];
    expect(topicOverlap("Tips and ways that you need to know about 2026", posts, NOW)).toBeNull();
  });

  it("is accent- and case-insensitive", () => {
    const posts = [post("Réussir ses semis de tomates au printemps", [], 20)];
    expect(topicOverlap("REUSSIR DES SEMIS DE TOMATES PRÉCOCES", posts, NOW)).not.toBeNull();
  });

  it("works in French, Spanish and German", () => {
    expect(
      topicOverlap("Comment réussir des semis de tomates précoces", [post("Réussir ses semis de tomates au printemps", [], 20)], NOW),
    ).not.toBeNull();
    expect(
      topicOverlap(
        "Cultivar tomates en macetas: guía para balcones",
        [post("Cómo cultivar tomates en macetas pequeñas", [], 20)],
        NOW,
      ),
    ).not.toBeNull();
    expect(
      topicOverlap("Tomaten düngen: richtig im Sommer", [post("Tomaten richtig düngen im Sommer", [], 20)], NOW),
    ).not.toBeNull();
  });

  it("applies to any recent post, whatever its age", () => {
    const old = [post("How to price a handmade candle for retail sales", [], 400)];
    expect(topicOverlap("Pricing handmade candles for retail", old, NOW)).not.toBeNull();
  });

  it("returns null when there is nothing to compare with", () => {
    expect(topicOverlap("Anything at all", [], NOW)).toBeNull();
  });
});

describe("topicOverlap: tag cooldown", () => {
  it("blocks a title containing a tag used once in the last 21 days", () => {
    const recent = [post("Starting seeds indoors", ["seeds", "indoor gardening"], 10)];
    const reason = topicOverlap("Choosing the right seeds for beginners", recent, NOW);
    expect(reason).toMatch(/seeds/);
    expect(reason).toMatch(/21 days/);
  });

  it("lets a tag used once, longer than 21 days ago, come back", () => {
    const recent = [post("Starting seeds indoors", ["seeds"], 30)];
    expect(topicOverlap("Choosing the right seeds for beginners", recent, NOW)).toBeNull();
  });

  it("treats the 21-day limit as inclusive on the recent side", () => {
    expect(topicOverlap("All about seeds", [post("A", ["seeds"], 21)], NOW)).not.toBeNull();
    expect(topicOverlap("All about seeds", [post("A", ["seeds"], 22)], NOW)).toBeNull();
  });

  it("blocks a tag used at least twice in the window, even if old", () => {
    const recent = [post("Starting seeds indoors", ["seeds"], 30), post("Saving seeds from fruit", ["seeds"], 50)];
    const reason = topicOverlap("Which seeds germinate fastest?", recent, NOW);
    expect(reason).toMatch(/2 times/);
    expect(reason).toMatch(/60 days/);
  });

  it("ignores posts older than the window for saturation", () => {
    const recent = [post("Starting seeds indoors", ["seeds"], 30), post("Saving seeds from fruit", ["seeds"], 70)];
    expect(topicOverlap("Which seeds germinate fastest?", recent, NOW)).toBeNull();
  });

  it("counts scheduled (future) posts as recent", () => {
    const recent = [post("Starting seeds indoors", ["seeds"], -5)];
    expect(topicOverlap("Which seeds germinate fastest?", recent, NOW)).not.toBeNull();
  });

  it("matches multi-word tags as a contiguous phrase", () => {
    const recent = [post("Light for seedlings", ["indoor gardening"], 5)];
    expect(topicOverlap("Indoor gardening mistakes to avoid", recent, NOW)).not.toBeNull();
    expect(topicOverlap("Indoor plants and gardening gear", recent, NOW)).toBeNull();
    expect(topicOverlap("Gardening indoor tips", recent, NOW)).toBeNull();
  });

  it("matches regardless of accents, hyphens, case and plural form", () => {
    const recent = [post("Un article", ["Éco-rénovation", "aide"], 5)];
    expect(topicOverlap("L'ECO-RENOVATION en 5 étapes", recent, NOW)).not.toBeNull();
    expect(topicOverlap("Les aides financières expliquées", recent, NOW)).not.toBeNull();
  });

  it("does not match a tag that is only part of a longer word", () => {
    const recent = [post("About cats", ["cat"], 5)];
    expect(topicOverlap("Concatenating strings the easy way", recent, NOW)).toBeNull();
    expect(topicOverlap("Caring for your cat", recent, NOW)).not.toBeNull();
  });

  it("ignores tags made only of filler words or too short to be meaningful", () => {
    const recent = [
      post("A", ["guide", "tips"], 5),
      post("B", ["guide", "tips"], 6),
      post("C", ["guide", "tips", "ai"], 7),
      post("D", ["ai"], 8),
    ];
    expect(topicOverlap("The guide to ai tips", recent, NOW)).toBeNull();
  });

  it("counts a tag once per post even if repeated", () => {
    const recent = [post("A", ["seeds", "Seeds", "seeds"], 40)];
    expect(topicOverlap("Which seeds germinate fastest?", recent, NOW)).toBeNull();
  });

  it("copes with posts that have no tags", () => {
    const recent = [{ title: "No tags here", tags: undefined as unknown as string[], publishedAt: NOW.toISOString() }];
    expect(topicOverlap("Something unrelated entirely", recent, NOW)).toBeNull();
  });

  it("counts an unparseable date towards saturation but never as fresh", () => {
    const once: RecentPost[] = [{ title: "A", tags: ["seeds"], publishedAt: "not a date" }];
    expect(topicOverlap("Which seeds germinate fastest?", once, NOW)).toBeNull();
    const twice: RecentPost[] = [...once, { title: "B", tags: ["seeds"], publishedAt: "" }];
    expect(topicOverlap("Which seeds germinate fastest?", twice, NOW)).not.toBeNull();
  });

  it("only reasons about the tags of the window, not about unrelated tags", () => {
    const recent = [post("A", ["seeds"], 5)];
    expect(topicOverlap("Pruning roses in winter", recent, NOW)).toBeNull();
  });
});

describe("annotateTopics / pickFreshTopic", () => {
  const recent = [post("Starting seeds indoors", ["seeds"], 5)];
  const topics = [
    { title: "Choosing seeds for a small balcony", angle: "angle one" },
    { title: "Pruning roses in winter", angle: "angle two" },
    { title: "Building a raised bed", angle: "angle three" },
  ];

  it("annotates every topic with its overlap reason or null, keeping order and content", () => {
    const annotated = annotateTopics(topics, recent, NOW);
    expect(annotated.map((t) => t.title)).toEqual(topics.map((t) => t.title));
    expect(annotated.map((t) => t.angle)).toEqual(topics.map((t) => t.angle));
    expect(annotated[0].overlap).toMatch(/seeds/);
    expect(annotated[1].overlap).toBeNull();
    expect(annotated[2].overlap).toBeNull();
  });

  it("agrees with topicOverlap", () => {
    for (const topic of topics) {
      expect(annotateTopics([topic], recent, NOW)[0].overlap).toBe(topicOverlap(topic.title, recent, NOW));
    }
  });

  it("picks the first topic that overlaps nothing", () => {
    expect(pickFreshTopic(topics, recent, NOW)).toEqual(topics[1]);
  });

  it("returns the first topic when nothing overlaps", () => {
    expect(pickFreshTopic(topics, [], NOW)).toEqual(topics[0]);
  });

  it("returns null when every topic overlaps, or there are no topics", () => {
    expect(pickFreshTopic([topics[0]], recent, NOW)).toBeNull();
    expect(pickFreshTopic([], recent, NOW)).toBeNull();
  });
});

describe("buildTopicsPrompt", () => {
  const settings: BlogSettings = {
    ...DEFAULT_SETTINGS,
    brandName: "Acme Gardening",
    language: "fr",
    audience: "Home gardeners",
    tone: "friendly and practical",
    topicGuidelines: "Focus on seasonal advice and small balconies.",
    companyContext: "We sell seeds and tools for urban gardens.",
  };
  const recent = [
    post("Starting seeds indoors", ["seeds", "indoor gardening"], 5),
    post("Saving seeds from fruit", ["seeds"], 30),
    post("Pruning roses in winter", ["roses"], 50),
  ];

  it("returns a system prompt carrying the persona and a user prompt", () => {
    const { system, prompt } = buildTopicsPrompt(settings, { count: 3, recent, exclude: [], now: NOW });
    expect(system).toContain("Acme Gardening");
    expect(system).toContain("Home gardeners");
    expect(system).toContain("urban gardens");
    expect(prompt.length).toBeGreaterThan(200);
  });

  it("asks for the requested count in the configured language", () => {
    const { prompt } = buildTopicsPrompt(settings, { count: 4, recent: [], exclude: [], now: NOW });
    expect(prompt).toContain("4 new blog article topics");
    expect(prompt).toContain("French (fr)");
    expect(prompt).toContain("exactly 4 topics");
  });

  it("uses the singular for one topic and never asks for fewer than one", () => {
    expect(buildTopicsPrompt(settings, { count: 1, recent: [], exclude: [], now: NOW }).prompt).toContain("1 new blog article topic,");
    expect(buildTopicsPrompt(settings, { count: 0, recent: [], exclude: [], now: NOW }).prompt).toContain("1 new blog article topic,");
  });

  it("includes the editorial guidelines and audience", () => {
    const { prompt } = buildTopicsPrompt(settings, { count: 3, recent: [], exclude: [], now: NOW });
    expect(prompt).toContain("Focus on seasonal advice and small balconies.");
    expect(prompt).toContain("Home gardeners");
  });

  it("omits the guidelines section when none are configured", () => {
    const { prompt } = buildTopicsPrompt({ ...settings, topicGuidelines: "" }, { count: 3, recent: [], exclude: [], now: NOW });
    expect(prompt).not.toContain("Editorial guidelines");
  });

  it("includes the title rules and the strict JSON contract", () => {
    const { prompt } = buildTopicsPrompt(settings, { count: 3, recent: [], exclude: [], now: NOW });
    expect(prompt).toContain("At most 65 characters");
    expect(prompt).toContain('{"topics":[{"title":"...","angle":"one sentence describing the angle"}]}');
    expect(prompt).toMatch(/STRICT JSON/);
  });

  it("includes today's date", () => {
    const { prompt } = buildTopicsPrompt(settings, { count: 3, recent: [], exclude: [], now: NOW });
    expect(prompt).toContain("2026-06-15");
  });

  it("lists over-used tags in a coverage block", () => {
    const { prompt } = buildTopicsPrompt(settings, { count: 3, recent, exclude: [], now: NOW });
    expect(prompt).toContain("## Coverage");
    expect(prompt).toContain("- seeds (2 posts)");
    expect(prompt).toContain("- indoor gardening (covered in the last 21 days)");
    // roses: used once, 50 days ago: only a soft restriction
    expect(prompt).not.toContain("- roses");
    expect(prompt).toMatch(/Covered once, a while ago.*roses/);
  });

  it("omits the coverage block when there is nothing to report", () => {
    const { prompt } = buildTopicsPrompt(settings, { count: 3, recent: [], exclude: [], now: NOW });
    expect(prompt).not.toContain("## Coverage");
    expect(prompt).not.toContain("Already published");
  });

  it("builds an avoid list from recent titles and the exclude list, without duplicates", () => {
    const { prompt } = buildTopicsPrompt(settings, {
      count: 3,
      recent,
      exclude: ["A topic the admin already saw", "starting seeds indoors"],
      now: NOW,
    });
    expect(prompt).toContain("- A topic the admin already saw");
    expect(prompt).toContain("- Pruning roses in winter");
    expect(prompt.match(/tarting seeds indoors/gi)).toHaveLength(1);
  });

  it("builds an avoid list from the exclude list alone", () => {
    const { prompt } = buildTopicsPrompt(settings, { count: 3, recent: [], exclude: ["Only excluded"], now: NOW });
    expect(prompt).toContain("- Only excluded");
  });

  it("caps the avoid list", () => {
    const many = Array.from({ length: 100 }, (_, i) => `Topic number ${i}`);
    const { prompt } = buildTopicsPrompt(settings, { count: 3, recent: [], exclude: many, now: NOW });
    expect(prompt.match(/^- Topic number/gm)).toHaveLength(40);
  });

  it("works with the default, empty settings and stays generic", () => {
    const { system, prompt } = buildTopicsPrompt(DEFAULT_SETTINGS, { count: 3, recent: [], exclude: [], now: NOW });
    expect(system).toContain("company blog");
    expect(prompt).toContain("English");
    expect(prompt).not.toMatch(/undefined|null|\[object/);
  });
});

describe("parseTopics", () => {
  it("parses the documented shape", () => {
    expect(parseTopics('{"topics":[{"title":"A","angle":"a"},{"title":"B","angle":"b"}]}')).toEqual([
      { title: "A", angle: "a" },
      { title: "B", angle: "b" },
    ]);
  });

  it("handles code fences and prose around the JSON", () => {
    const raw = 'Here are the topics:\n```json\n{"topics":[{"title":"A","angle":"a"}]}\n```\nEnjoy!';
    expect(parseTopics(raw)).toEqual([{ title: "A", angle: "a" }]);
  });

  it("handles trailing text after bare JSON", () => {
    expect(parseTopics('{"topics":[{"title":"A","angle":"a"}]} (three topics requested)')).toEqual([
      { title: "A", angle: "a" },
    ]);
  });

  it("accepts a bare array", () => {
    expect(parseTopics('[{"title":"A","angle":"a"},{"title":"B"}]')).toEqual([
      { title: "A", angle: "a" },
      { title: "B", angle: "" },
    ]);
  });

  it("accepts plain strings as titles", () => {
    expect(parseTopics('{"topics":["First idea","Second idea"]}')).toEqual([
      { title: "First idea", angle: "" },
      { title: "Second idea", angle: "" },
    ]);
  });

  it("trims and collapses whitespace", () => {
    expect(parseTopics('{"topics":[{"title":"  Spaced   out \\n title ","angle":" an  angle "}]}')).toEqual([
      { title: "Spaced out title", angle: "an angle" },
    ]);
  });

  it("skips invalid entries and keeps the valid ones", () => {
    const raw = JSON.stringify({
      topics: [{ title: "Good", angle: "ok" }, { angle: "no title" }, { title: "  " }, { title: 7 }, null, 12, { title: "Also good" }],
    });
    expect(parseTopics(raw)).toEqual([
      { title: "Good", angle: "ok" },
      { title: "Also good", angle: "" },
    ]);
  });

  it("removes duplicate titles, ignoring case", () => {
    expect(parseTopics('{"topics":[{"title":"Same"},{"title":"same"},{"title":"Other"}]}')).toHaveLength(2);
  });

  it("tolerates trailing commas and raw newlines", () => {
    const raw = '{"topics":[{"title":"A","angle":"line\none",},]}';
    expect(parseTopics(raw)).toEqual([{ title: "A", angle: "line one" }]);
  });

  it("does not cap the number of topics (the caller decides)", () => {
    const topics = Array.from({ length: 8 }, (_, i) => ({ title: `Topic ${i}`, angle: "" }));
    expect(parseTopics(JSON.stringify({ topics }))).toHaveLength(8);
  });

  it("throws when nothing is usable", () => {
    expect(() => parseTopics('{"topics":[]}')).toThrow(/no usable topic/);
    expect(() => parseTopics('{"topics":[{"angle":"x"}]}')).toThrow(/no usable topic/);
    expect(() => parseTopics('{"other":1}')).toThrow(/topics/);
    expect(() => parseTopics('{"topics":"nope"}')).toThrow(/topics/);
  });

  it("throws on empty, non-JSON and truncated responses", () => {
    expect(() => parseTopics("")).toThrow(Error);
    expect(() => parseTopics("I could not think of anything.")).toThrow(Error);
    expect(() => parseTopics('{"topics":[{"title":"A","angle":"cut')).toThrow(/truncated|incomplete/i);
  });
});
