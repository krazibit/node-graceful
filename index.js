// +----------------------------------------------------------------------+
// | node-graceful v0.3.1 (https://github.com/mrbar42/node-graceful)      |
// | Graceful process exit manager.                                       |
// |----------------------------------------------------------------------|
'use strict';

function Graceful() {
    // options
    this.exitOnDouble = true;
    this.timeout = 30000;

    // constants
    this.DEADLY_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGBREAK', 'SIGHUP'];

    // state
    this._listeners = Object.create(null);
    this.isExiting = false;
}

Graceful.prototype.on = function on(signal, listener, deadly) {
    this._registerSignal(signal);

    this._listeners[signal].push(listener);

    // add signal to deadly list
    if (deadly && this.DEADLY_SIGNALS.indexOf(signal) === -1) {
        this.DEADLY_SIGNALS.push(signal);
    }

    return () => this.off(signal, listener);
};

Graceful.prototype.off = function off(signal, listener) {
    if (!this._listeners[signal]) return;

    // remove listener if exists
    let index = this._listeners[signal].indexOf(listener);
    if (index !== -1) this._listeners[signal].splice(index, 1);

    // clear master listener if no listeners left
    if (!this._listeners[signal].length) {
        this._unregisterSignal(signal);
    }
};

Graceful.prototype.clear = function clear(signal) {
    if (signal) {
        delete this._listeners[signal];
        this._unregisterSignal(signal);
    }
    else {
        Object
            .keys(this._listeners)
            .forEach(sig => this.clear(sig));
    }
};

Graceful.prototype.exit = function exit(code, signal) {
    if (typeof code === 'number') {
        process.exitCode = code;
    }

    let simulatedSignal = signal || this.DEADLY_SIGNALS[0];

    this._processSignal(simulatedSignal);
};

Graceful.prototype._registerSignal = function _registerSignal(signal) {
    if (this._listeners[signal]) return;

    this._listeners[signal] = [];

    let handler = event => this._processSignal(signal, event);

    // handle special 'exit' event case
    if (signal === 'exit') {
        this.DEADLY_SIGNALS.forEach(deadlySignal => process.on(deadlySignal, handler));
    }
    else {
        process.on(signal, handler);
    }

    // store handler on listeners array for future ref
    this._listeners[signal].__handler__ = handler;
};

Graceful.prototype._unregisterSignal = function _unregisterSignal(signal) {
    if (!this._listeners[signal]) return;

    let handler = this._listeners[signal].__handler__;

    // handle special 'exit' event case
    if (signal === 'exit') {
        this.DEADLY_SIGNALS.forEach(deadlySignal => process.removeListener(deadlySignal, handler));
    }
    else {
        process.removeListener(signal, handler);
    }

    delete this._listeners[signal];
};

Graceful.prototype._processSignal = function _processSignal(signal, event) {
    let deadly = this.DEADLY_SIGNALS.indexOf(signal) !== -1;
    let listeners = this._listeners[signal] && this._listeners[signal].slice();
    let exitListeners = this._listeners['exit'] && this._listeners['exit'].slice();
    let targetCount = listeners && listeners.length || 0;

    // also include exit listeners if deadly
    if (deadly && exitListeners) {
        targetCount += exitListeners.length;
    }

    // this should never happen
    if (!targetCount) {
        return process.nextTick(() => this._killProcess());
    }

    let quit = (() => {
        let count = 0;
        return () => {
            count++;
            if (count >= targetCount) {
                if (deadly) this._killProcess();
            }
        };
    })();

    // exec signal specific listeners
    if (listeners) {
        listeners.forEach(listener => this._invokeListener(listener, quit, event, signal));
    }


    // also invoke exit listeners
    if (deadly && exitListeners) {
        if (this.isExiting) {
            if (this.exitOnDouble) this._killProcess(true);
        }
        else {
            this.isExiting = true;
            if (Number(this.timeout)) {
                setTimeout(() => this._killProcess(true), this.timeout);
            }
            exitListeners.forEach(listener => this._invokeListener(listener, quit, event, signal));
        }
    }
};

Graceful.prototype._killProcess = function _killProcess(force) {
    process.exit(process.exitCode || (force ? 1 : 0));
};

Graceful.prototype._invokeListener = function _invokeListener(listener, quit, event, signal) {
    let invoked = false;
    // listener specific callback
    let done = () => {
        if (!invoked) {
            invoked = true;
            quit();
        }
    };

    let retVal = listener(done, event, signal);
    // allow returning a promise
    if (retVal && typeof retVal.then === 'function' && typeof retVal.catch === 'function') {
        retVal.then(done).catch(done);
    }
};

let graceful = new Graceful();
module.exports = graceful;

// monkey patch exports to support both old & new & Typescript module systems
module.exports.Graceful = graceful;
module.exports.default = graceful;
