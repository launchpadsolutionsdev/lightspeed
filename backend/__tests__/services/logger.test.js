/**
 * Tests for the structured logger service.
 */

describe('logger', () => {
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        jest.resetModules();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('outputs JSON in production mode', () => {
        process.env.NODE_ENV = 'production';
        process.env.LOG_LEVEL = 'debug';
        const spy = jest.spyOn(console, 'log').mockImplementation();

        const log = require('../../src/services/logger');
        log.info('test message', { key: 'value' });

        expect(spy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(spy.mock.calls[0][0]);
        expect(output.level).toBe('info');
        expect(output.message).toBe('test message');
        expect(output.key).toBe('value');
        expect(output.timestamp).toBeDefined();

        spy.mockRestore();
    });

    it('outputs human-readable format in development', () => {
        process.env.NODE_ENV = 'development';
        process.env.LOG_LEVEL = 'debug';
        const spy = jest.spyOn(console, 'log').mockImplementation();

        const log = require('../../src/services/logger');
        log.info('hello world');

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toContain('[INFO]');
        expect(spy.mock.calls[0][0]).toContain('hello world');

        spy.mockRestore();
    });

    it('respects LOG_LEVEL filtering', () => {
        process.env.NODE_ENV = 'development';
        process.env.LOG_LEVEL = 'warn';
        const spy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        const log = require('../../src/services/logger');
        log.debug('should be hidden');
        log.info('should be hidden');
        log.warn('should be visible');

        expect(spy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledTimes(1);

        spy.mockRestore();
        warnSpy.mockRestore();
    });

    it('serializes Error objects with stack traces in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.LOG_LEVEL = 'debug';
        const spy = jest.spyOn(console, 'error').mockImplementation();

        const log = require('../../src/services/logger');
        const err = new Error('test error');
        log.error('something failed', { error: err });

        const output = JSON.parse(spy.mock.calls[0][0]);
        expect(output.error.message).toBe('test error');
        expect(output.error.stack).toBeDefined();

        spy.mockRestore();
    });
});
