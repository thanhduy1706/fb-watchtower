import { describe, it, expect, vi } from 'vitest';
import { ReasonerAgent } from '../src/agents/reasoner.js';
import type { Observation } from '../src/types/index.js';

// ── Helpers ──────────────────────────────────────────────────────

const BASE = 'https://www.facebook.com/TestPage/posts';

function makeObservation(candidates: string[]): Observation {
  return {
    latest_post_link: candidates[0],
    candidate_post_links: candidates,
    extracted_at: new Date().toISOString(),
    content_preview: 'preview',
    raw_dom_hash: 'hash',
  };
}

function mockMemory(recents: string[] = []): any {
  return {
    getRecentPosts: vi.fn().mockResolvedValue(recents),
    setLastPost: vi.fn().mockResolvedValue(undefined),
    addPosts: vi.fn().mockResolvedValue(undefined),
  };
}

function silentLogger(): any {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

// ── Tests ────────────────────────────────────────────────────────

describe('ReasonerAgent', () => {
  it('seeds ALL observed candidates on first run, not just the first', async () => {
    const memory = mockMemory([]);
    const reasoner = new ReasonerAgent(memory, silentLogger());
    const candidates = [`${BASE}/111`, `${BASE}/222`, `${BASE}/333`];

    const decision = await reasoner.evaluate(makeObservation(candidates));

    expect(decision.changeDetected).toBe(false);
    // Every post visible on the page at startup is old news — all must be
    // recorded as seen so later cycles don't notify about them.
    expect(memory.addPosts).toHaveBeenCalledWith(candidates);
  });

  it('does not notify when all candidates were already seen', async () => {
    const recents = [`${BASE}/111`, `${BASE}/222`];
    const reasoner = new ReasonerAgent(mockMemory(recents), silentLogger());

    const decision = await reasoner.evaluate(makeObservation(recents));

    expect(decision.changeDetected).toBe(false);
    expect(decision.postLink).toBeNull();
  });

  it('notifies about the first unseen candidate when a new post appears', async () => {
    const recents = [`${BASE}/111`, `${BASE}/222`];
    const reasoner = new ReasonerAgent(mockMemory(recents), silentLogger());
    const newPost = `${BASE}/999`;

    const decision = await reasoner.evaluate(
      makeObservation([newPost, `${BASE}/111`, `${BASE}/222`]),
    );

    expect(decision.changeDetected).toBe(true);
    expect(decision.postLink).toBe(newPost);
  });

  it('returns ALL unseen candidates in newLinks so they can be marked seen at once', async () => {
    const recents = [`${BASE}/111`];
    const reasoner = new ReasonerAgent(mockMemory(recents), silentLogger());
    // Same post extracted under two ID formats plus one genuinely-seen post:
    // both unseen links must be reported so only ONE notification ever fires.
    const newPfbid = `${BASE}/pfbid0AbCdEf`;
    const newNumeric = `${BASE}/1234567890123`;

    const decision = await reasoner.evaluate(
      makeObservation([newPfbid, newNumeric, `${BASE}/111`]),
    );

    expect(decision.changeDetected).toBe(true);
    expect(decision.postLink).toBe(newPfbid);
    expect(decision.newLinks).toEqual([newPfbid, newNumeric]);
  });

  it('compares links ignoring query strings', async () => {
    const recents = [`${BASE}/111?ref=page_internal`];
    const reasoner = new ReasonerAgent(mockMemory(recents), silentLogger());

    const decision = await reasoner.evaluate(makeObservation([`${BASE}/111?locale=en`]));

    expect(decision.changeDetected).toBe(false);
  });
});
