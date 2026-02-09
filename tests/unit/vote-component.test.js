import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the vote.js source
const voteJsSrc = fs.readFileSync(path.join(__dirname, '../../public/js/vote.js'), 'utf-8');

describe('Vote Component', () => {
  let renderVoteControls;
  let getStoredVotes;
  let storeVote;

  beforeEach(() => {
    // Mock localStorage
    const storage = {};
    global.localStorage = {
      getItem: vi.fn((key) => storage[key] || null),
      setItem: vi.fn((key, val) => { storage[key] = val; }),
      removeItem: vi.fn((key) => { delete storage[key]; }),
    };

    // Mock API
    global.API = {
      post: vi.fn().mockResolvedValue({ success: true, vote_score: 1, upvotes: 1, downvotes: 0, user_vote: 1 }),
    };

    // Mock socket
    global.socket = { on: vi.fn() };

    // Evaluate the vote.js source to get functions
    const module = {};
    const fn = new Function('module', 'localStorage', 'API', 'socket', voteJsSrc + '\nmodule.renderVoteControls = renderVoteControls; module.getStoredVotes = getStoredVotes; module.storeVote = storeVote;');
    fn(module, global.localStorage, global.API, global.socket);
    renderVoteControls = module.renderVoteControls;
    getStoredVotes = module.getStoredVotes;
    storeVote = module.storeVote;
  });

  it('renderVoteControls returns correct HTML structure', () => {
    const html = renderVoteControls(42, 5, 0);
    expect(html).toContain('data-quote-id="42"');
    expect(html).toContain('vote-controls');
    expect(html).toContain('vote-up');
    expect(html).toContain('vote-down');
    expect(html).toContain('vote-score');
    expect(html).toContain('>5<');
  });

  it('active state applied correctly for upvote', () => {
    const html = renderVoteControls(1, 3, 1);
    // Up button should have active class
    expect(html).toMatch(/vote-up\s+active/);
    // Down button should not
    expect(html).not.toMatch(/vote-down\s+active/);
  });

  it('active state applied correctly for downvote', () => {
    const html = renderVoteControls(1, -1, -1);
    // Down button should have active class
    expect(html).toMatch(/vote-down\s+active/);
    // Up button should not
    expect(html).not.toMatch(/vote-up\s+active/);
  });

  it('no active state when userVote is 0', () => {
    const html = renderVoteControls(1, 0, 0);
    expect(html).not.toMatch(/vote-up\s*active/);
    expect(html).not.toMatch(/vote-down\s*active/);
  });

  it('score displays correctly for positive, negative, zero', () => {
    expect(renderVoteControls(1, 42, 0)).toContain('>42<');
    expect(renderVoteControls(1, -5, 0)).toContain('>-5<');
    expect(renderVoteControls(1, 0, 0)).toContain('>0<');
  });

  it('has-votes class applied when score is non-zero', () => {
    expect(renderVoteControls(1, 5, 0)).toContain('has-votes');
    expect(renderVoteControls(1, 0, 0)).not.toContain('has-votes');
  });

  it('localStorage reads/writes vote state', () => {
    expect(getStoredVotes()).toEqual({});

    storeVote(42, 1);
    expect(global.localStorage.setItem).toHaveBeenCalled();

    // Simulate reading back
    const lastCall = global.localStorage.setItem.mock.calls[global.localStorage.setItem.mock.calls.length - 1];
    const stored = JSON.parse(lastCall[1]);
    expect(stored[42]).toBe(1);
  });

  it('storeVote removes entry when value is 0', () => {
    storeVote(42, 1);
    storeVote(42, 0);

    const lastCall = global.localStorage.setItem.mock.calls[global.localStorage.setItem.mock.calls.length - 1];
    const stored = JSON.parse(lastCall[1]);
    expect(stored[42]).toBeUndefined();
  });

  it('localStorage vote overrides server userVote in render', () => {
    // Store a vote in localStorage
    global.localStorage.getItem = vi.fn(() => JSON.stringify({ 99: -1 }));

    const html = renderVoteControls(99, 0, 1); // server says upvote, localStorage says downvote
    // Should use localStorage value (downvote)
    expect(html).toMatch(/vote-down[^"]*active/);
  });
});
