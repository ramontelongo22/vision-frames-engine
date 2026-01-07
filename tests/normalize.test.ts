/**
 * Vision Frames v1 - Normalize Tests
 */

import { normalize } from '../src/normalize';

describe('normalize', () => {
  describe('disallowed framing words', () => {
    it('should strip "manifest" and "manifestation"', () => {
      const result = normalize({
        identityDirection: 'manifest my best self',
        environmentPreference: 'manifestation space',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('manifest');
      expect(result.environmentPreference?.toLowerCase()).not.toContain('manifestation');
    });

    it('should strip "wealthy", "rich", "successful"', () => {
      const result = normalize({
        identityDirection: 'wealthy and successful person',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('wealthy');
      expect(result.identityDirection.toLowerCase()).not.toContain('successful');
    });

    it('should strip "hustle" and "grind"', () => {
      const result = normalize({
        identityDirection: 'hustle and grind mindset',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('hustle');
      expect(result.identityDirection.toLowerCase()).not.toContain('grind');
    });

    it('should strip "fantasy" and "dream life"', () => {
      const result = normalize({
        identityDirection: 'living my fantasy dream life',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('fantasy');
      expect(result.identityDirection.toLowerCase()).not.toContain('dream life');
    });

    it('should strip "glow-up" and "upgrade"', () => {
      const result = normalize({
        identityDirection: 'glow-up upgrade transformation',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('glow-up');
      expect(result.identityDirection.toLowerCase()).not.toContain('glow up');
      expect(result.identityDirection.toLowerCase()).not.toContain('upgrade');
    });
  });

  describe('actions and poses', () => {
    it('should strip sitting/seated', () => {
      const result = normalize({
        identityDirection: 'sitting in a chair',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('sitting');
      expect(result.identityDirection.toLowerCase()).not.toContain('seated');
    });

    it('should strip holding objects', () => {
      const result = normalize({
        identityDirection: 'holding a briefcase',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('holding');
    });

    it('should strip working and gesturing', () => {
      const result = normalize({
        identityDirection: 'working and gesturing confidently',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('working');
      expect(result.identityDirection.toLowerCase()).not.toContain('gesturing');
    });
  });

  describe('objects and props', () => {
    it('should strip laptop, phone, briefcase', () => {
      const result = normalize({
        identityDirection: 'with laptop and phone and briefcase',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('laptop');
      expect(result.identityDirection.toLowerCase()).not.toContain('phone');
      expect(result.identityDirection.toLowerCase()).not.toContain('briefcase');
    });

    it('should strip coffee and food items', () => {
      const result = normalize({
        identityDirection: 'enjoying coffee and food',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('coffee');
      expect(result.identityDirection.toLowerCase()).not.toContain('food');
    });
  });

  describe('jobs, roles, outcomes', () => {
    it('should strip CEO, founder, entrepreneur', () => {
      const result = normalize({
        identityDirection: 'CEO and founder entrepreneur',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('ceo');
      expect(result.identityDirection.toLowerCase()).not.toContain('founder');
      expect(result.identityDirection.toLowerCase()).not.toContain('entrepreneur');
    });

    it('should strip success and achievement terms', () => {
      const result = normalize({
        identityDirection: 'achieving success and accomplishment',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('success');
      expect(result.identityDirection.toLowerCase()).not.toContain('achievement');
      expect(result.identityDirection.toLowerCase()).not.toContain('accomplishment');
    });
  });

  describe('commands and instructions', () => {
    it('should strip command verbs', () => {
      const result = normalize({
        identityDirection: 'create and generate an image showing me',
      });

      expect(result.identityDirection.toLowerCase()).not.toContain('create');
      expect(result.identityDirection.toLowerCase()).not.toContain('generate');
      expect(result.identityDirection.toLowerCase()).not.toContain('show');
    });
  });

  describe('optional fields', () => {
    it('should handle missing environmentPreference', () => {
      const result = normalize({
        identityDirection: 'calm presence',
      });

      expect(result.identityDirection).toBe('calm presence');
      expect(result.environmentPreference).toBeUndefined();
      expect(result.moodTone).toBeUndefined();
    });

    it('should handle missing moodTone', () => {
      const result = normalize({
        identityDirection: 'grounded individual',
        environmentPreference: 'urban setting',
      });

      expect(result.identityDirection).toBeDefined();
      expect(result.environmentPreference).toBeDefined();
      expect(result.moodTone).toBeUndefined();
    });

    it('should omit optional fields if they become empty after normalization', () => {
      const result = normalize({
        identityDirection: 'composed',
        environmentPreference: 'wealthy luxury',
        moodTone: 'successful',
      });

      expect(result.identityDirection).toBe('composed');
      expect(result.environmentPreference).toBeUndefined();
      expect(result.moodTone).toBeUndefined();
    });
  });

  describe('whitespace handling', () => {
    it('should clean up extra whitespace', () => {
      const result = normalize({
        identityDirection: '  calm    and    grounded  ',
      });

      expect(result.identityDirection).toBe('calm and grounded');
    });
  });

  describe('silent operation', () => {
    it('should never throw errors on disallowed content', () => {
      expect(() => {
        normalize({
          identityDirection: 'manifest wealthy CEO holding laptop sitting down',
        });
      }).not.toThrow();
    });
  });
});
