import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chartsJsSrc = fs.readFileSync(path.join(__dirname, '../../public/js/charts.js'), 'utf-8');

describe('Charts Factory', () => {
  let fns;

  beforeEach(() => {
    // Mock Chart.js constructor
    const mockChartInstance = { destroy: vi.fn(), update: vi.fn() };
    global.Chart = vi.fn(() => mockChartInstance);
    global.Chart.defaults = {
      font: {},
      color: '',
      plugins: { tooltip: {}, legend: { labels: {} } },
    };

    // Mock DOM
    global.document = {
      getElementById: vi.fn(() => ({ getContext: vi.fn() })),
    };

    fns = {};
    const fn = new Function(
      'Chart', 'document',
      chartsJsSrc +
      '\nreturn { _activeCharts, CHART_COLORS, registerChart, destroyChart, destroyAllCharts, ' +
      'initChartDefaults, createTimelineChart, createBarChart, createDoughnutChart, ' +
      'createStackedBarChart, fillMissingDates };'
    );
    fns = fn(global.Chart, global.document);
  });

  it('registerChart and destroyChart lifecycle', () => {
    const mockInstance = { destroy: vi.fn() };
    fns.registerChart('test-chart', mockInstance);
    expect(fns._activeCharts['test-chart']).toBe(mockInstance);

    fns.destroyChart('test-chart');
    expect(mockInstance.destroy).toHaveBeenCalled();
    expect(fns._activeCharts['test-chart']).toBeUndefined();
  });

  it('registerChart replaces existing chart', () => {
    const old = { destroy: vi.fn() };
    const next = { destroy: vi.fn() };
    fns.registerChart('x', old);
    fns.registerChart('x', next);
    expect(old.destroy).toHaveBeenCalled();
    expect(fns._activeCharts['x']).toBe(next);
  });

  it('destroyAllCharts clears all entries', () => {
    const a = { destroy: vi.fn() };
    const b = { destroy: vi.fn() };
    fns.registerChart('a', a);
    fns.registerChart('b', b);
    fns.destroyAllCharts();
    expect(a.destroy).toHaveBeenCalled();
    expect(b.destroy).toHaveBeenCalled();
  });

  it('createTimelineChart returns chart instance', () => {
    const chart = fns.createTimelineChart('canvas1', ['Mon', 'Tue'], [{ label: 'Quotes', data: [5, 10] }]);
    expect(chart).toBeTruthy();
    expect(global.Chart).toHaveBeenCalled();
    const callArgs = global.Chart.mock.calls[0][1];
    expect(callArgs.type).toBe('line');
  });

  it('createBarChart creates horizontal bar', () => {
    const chart = fns.createBarChart('canvas2', ['Author A', 'Author B'], [5, 3]);
    expect(chart).toBeTruthy();
    const callArgs = global.Chart.mock.calls[0][1];
    expect(callArgs.type).toBe('bar');
    expect(callArgs.options.indexAxis).toBe('y');
  });

  it('createDoughnutChart creates doughnut', () => {
    const chart = fns.createDoughnutChart('canvas3', ['Topic A', 'Topic B'], [10, 5]);
    expect(chart).toBeTruthy();
    const callArgs = global.Chart.mock.calls[0][1];
    expect(callArgs.type).toBe('doughnut');
  });

  it('fillMissingDates fills gaps with zero', () => {
    const buckets = [
      { bucket: '2025-01-01', count: 5 },
      { bucket: '2025-01-03', count: 3 },
    ];
    const result = fns.fillMissingDates(buckets, '2025-01-01', '2025-01-04');
    expect(result.length).toBe(4);
    expect(result[0]).toEqual({ bucket: '2025-01-01', count: 5 });
    expect(result[1]).toEqual({ bucket: '2025-01-02', count: 0 });
    expect(result[2]).toEqual({ bucket: '2025-01-03', count: 3 });
    expect(result[3]).toEqual({ bucket: '2025-01-04', count: 0 });
  });

  it('returns null when Chart.js not loaded', () => {
    // Re-evaluate without Chart global
    const fn = new Function(
      'document',
      chartsJsSrc.replace(/var CHART_COLORS/, 'var Chart = undefined;\nvar CHART_COLORS') +
      '\nreturn { createTimelineChart, createBarChart, createDoughnutChart };'
    );
    const noChart = fn(global.document);
    expect(noChart.createTimelineChart('c', [], [])).toBeNull();
    expect(noChart.createBarChart('c', [], [])).toBeNull();
    expect(noChart.createDoughnutChart('c', [], [])).toBeNull();
  });

  it('CHART_COLORS has 8 entries', () => {
    expect(fns.CHART_COLORS.length).toBe(8);
  });
});
