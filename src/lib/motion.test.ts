import { describe, expect, it } from 'vitest';
import { parallaxOffset, parseSpeed, revealDelay } from './motion';

describe('parallaxe', () => {
  it('vitesse lue et bornée', () => {
    expect(parseSpeed('0.25')).toBe(0.25);
    expect(parseSpeed('-0.4')).toBe(-0.4);
    expect(parseSpeed('3')).toBe(1);
    expect(parseSpeed('-9')).toBe(-1);
    expect(parseSpeed('abc')).toBe(0);
    expect(parseSpeed(undefined)).toBe(0);
  });
  it('nul au centre de l’écran, opposé au décalage, borné', () => {
    expect(parallaxOffset(400, 800, 0.5)).toBe(0);
    expect(parallaxOffset(600, 800, 0.5)).toBe(-100);
    expect(parallaxOffset(200, 800, 0.5)).toBe(100);
    expect(parallaxOffset(5000, 800, 0.5)).toBe(-120);
    expect(parallaxOffset(5000, 800, 0.5, 40)).toBe(-40);
    expect(parallaxOffset(500, 800, -0.33)).toBe(33);
  });
  it('apparitions échelonnées et plafonnées', () => {
    expect(revealDelay(0)).toBe(0);
    expect(revealDelay(2)).toBe(160);
    expect(revealDelay(20)).toBe(400);
    expect(revealDelay(-1)).toBe(0);
  });
});
