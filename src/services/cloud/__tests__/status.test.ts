import { describe, it, expect } from 'vitest';
import { canTransition, isKitchenVisible } from '../status';

describe('canTransition', () => {
  it('walks the happy path', () => {
    expect(canTransition('AWAITING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransition('PAID', 'ACCEPTED')).toBe(true);
    expect(canTransition('ACCEPTED', 'PREPARING')).toBe(true);
    expect(canTransition('PREPARING', 'READY')).toBe(true);
    expect(canTransition('READY', 'SERVED')).toBe(true);
  });

  it('never lets an unpaid order reach the kitchen', () => {
    expect(canTransition('AWAITING_PAYMENT', 'PREPARING')).toBe(false);
    expect(canTransition('AWAITING_PAYMENT', 'ACCEPTED')).toBe(false);
    expect(canTransition('PAYMENT_FAILED', 'PAID')).toBe(false);
  });

  it('refuses to move backwards or out of a terminal state', () => {
    expect(canTransition('READY', 'PREPARING')).toBe(false);
    expect(canTransition('SERVED', 'READY')).toBe(false);
    expect(canTransition('CANCELLED', 'PAID')).toBe(false);
  });

  it('allows cancelling anything not yet served', () => {
    expect(canTransition('PAID', 'CANCELLED')).toBe(true);
    expect(canTransition('PREPARING', 'CANCELLED')).toBe(true);
    expect(canTransition('SERVED', 'CANCELLED')).toBe(false);
  });
});

describe('isKitchenVisible', () => {
  it('hides orders that have not been paid for', () => {
    expect(isKitchenVisible('AWAITING_PAYMENT')).toBe(false);
    expect(isKitchenVisible('PAYMENT_FAILED')).toBe(false);
  });

  it('shows paid work the kitchen still has to do', () => {
    expect(isKitchenVisible('PAID')).toBe(true);
    expect(isKitchenVisible('ACCEPTED')).toBe(true);
    expect(isKitchenVisible('PREPARING')).toBe(true);
    expect(isKitchenVisible('READY')).toBe(true);
  });

  it('drops finished and cancelled tickets off the screen', () => {
    expect(isKitchenVisible('SERVED')).toBe(false);
    expect(isKitchenVisible('CANCELLED')).toBe(false);
  });
});
