/**
 * Starter error classification tests (Workstream D)
 */
import { classifyStarterError, handleStarterWriteError } from '../starterErrors';
import type { Response } from 'express';

function makeRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json, _json: json } as unknown as Response & { _json: jest.Mock };
}

describe('classifyStarterError', () => {
  it('classifies quota error by message', () => {
    const err = new Error('You are over your space quota');
    const result = classifyStarterError(err);
    expect(result.isQuota).toBe(true);
    expect(result.isStarterError).toBe(true);
  });

  it('classifies quota error by code 8000', () => {
    const err = Object.assign(new Error('some error'), { code: 8000 });
    const result = classifyStarterError(err);
    expect(result.isQuota).toBe(true);
  });

  it('classifies connection error', () => {
    const err = new Error('ECONNREFUSED 127.0.0.1:27017');
    const result = classifyStarterError(err);
    expect(result.isConnection).toBe(true);
    expect(result.isStarterError).toBe(true);
  });

  it('classifies server selection timeout', () => {
    const err = new Error('server selection timed out after 30000 ms');
    const result = classifyStarterError(err);
    expect(result.isConnection).toBe(true);
  });

  it('does not classify a regular error', () => {
    const err = new Error('some other problem');
    const result = classifyStarterError(err);
    expect(result.isQuota).toBe(false);
    expect(result.isConnection).toBe(false);
    expect(result.isStarterError).toBe(false);
  });
});

describe('handleStarterWriteError', () => {
  it('returns true and sends 507 for starter errors', () => {
    const err = new Error('over your space quota');
    const res = makeRes();
    const handled = handleStarterWriteError(err, res);
    expect(handled).toBe(true);
    expect(res.status).toHaveBeenCalledWith(507);
  });

  it('returns false for non-starter errors', () => {
    const err = new Error('validation failed');
    const res = makeRes();
    const handled = handleStarterWriteError(err, res);
    expect(handled).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });
});
