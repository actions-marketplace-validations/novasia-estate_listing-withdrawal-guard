'use strict';

const PUBLIC_STATES = new Set(['listed', 'reserved']);
const STATES = new Set([...PUBLIC_STATES, 'withdrawn', 'draft']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function indexRecords(rows, label, validate) {
  if (!Array.isArray(rows)) {
    throw new Error(`${label} must be an array.`);
  }
  const index = new Map();
  for (const [offset, row] of rows.entries()) {
    const location = `${label} row ${offset + 1}`;
    if (!isRecord(row) || typeof row.id !== 'string' || !ID.test(row.id)) {
      throw new Error(`${location} must have a valid listing ID.`);
    }
    if (index.has(row.id)) {
      throw new Error(`${location} has a duplicate listing ID.`);
    }
    validate(row, location);
    index.set(row.id, row);
  }
  return index;
}

function validateListing(row, location) {
  if (!STATES.has(row.status)) {
    throw new Error(`${location} must have status draft, listed, reserved, or withdrawn.`);
  }
}

function isCalendarDay(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateWithdrawal(row, location) {
  if (!isCalendarDay(row.withdrawnOn)) {
    throw new Error(`${location} must have a valid withdrawnOn date.`);
  }
  if (Object.hasOwn(row, 'reinstatedOn') &&
      (!isCalendarDay(row.reinstatedOn) || row.reinstatedOn < row.withdrawnOn)) {
    throw new Error(`${location} must have a reinstatedOn date on or after withdrawal.`);
  }
}

function audit(current, withdrawals, previous) {
  const candidate = indexRecords(current, 'Current snapshot', validateListing);
  const register = indexRecords(withdrawals, 'Withdrawal register', validateWithdrawal);
  const baseline = previous === undefined
    ? undefined
    : indexRecords(previous, 'Previous snapshot', validateListing);
  const result = [];
  for (const [id, row] of candidate) {
    const withdrawal = register.get(id);
    if (!withdrawal || withdrawal.reinstatedOn || !PUBLIC_STATES.has(row.status)) continue;
    let kind = 'public';
    if (baseline) {
      kind = PUBLIC_STATES.has(baseline.get(id)?.status) ? 'already-public' : 'reappeared';
    }
    result.push({ id, kind, status: row.status, withdrawnOn: withdrawal.withdrawnOn });
  }
  return result.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

module.exports = { audit };
