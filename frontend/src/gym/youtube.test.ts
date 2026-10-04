import { describe, expect, it } from "vitest";

import { youtubeId, youtubeStart } from "./youtube";

const ID = "dQw4w9WgXcQ";

describe("youtubeId", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=30`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=5`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ])("accepts %s", (url) => {
    expect(youtubeId(url)).toBe(ID);
  });

  it.each([
    `http://www.youtube.com/watch?v=${ID}`,
    `javascript:alert(1)//youtube.com/watch?v=${ID}`,
    `https://youtube.com.evil.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://evil.com/?u=youtube.com/watch?v=${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`,
    `https://youtu.be.evil.com/${ID}`,
    `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/watch?v=${ID}x`,
    `https://www.youtube.com/watch?v=abc<>def123`,
    `https://www.youtube.com/watch`,
    `https://www.youtube.com/playlist?list=${ID}`,
    `https://www.youtube-nocookie.com/watch?v=${ID}`,
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(youtubeId(url)).toBeNull();
  });
});

describe("youtubeStart", () => {
  it.each([
    [`https://youtu.be/${ID}?t=90`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=90s`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, 90],
    [`https://www.youtube.com/watch?v=${ID}&start=45`, 45],
    [`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`, 3723],
    [`https://www.youtube.com/watch?v=${ID}`, null],
    [`https://www.youtube.com/watch?v=${ID}&t=abc`, null],
    [`https://www.youtube.com/watch?v=${ID}&t=0`, null],
    [`https://www.youtube.com/watch?v=${ID}&t=`, null],
    [`http://youtu.be/${ID}?t=9`, null],
  ])("%s -> %s", (url, want) => {
    expect(youtubeStart(url)).toBe(want);
  });
});
