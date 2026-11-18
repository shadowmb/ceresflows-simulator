/**
 * AnswerQueue - holds one transport's answers for the configured response delay.
 *
 * Each answer is due at max(now + delay, due time of the last pending answer),
 * so a later answer never overtakes an earlier one, even when the delay changes.
 * With nothing pending and a delay of 0, an answer is sent at once.
 * Never blocks: one timer, for the earliest pending answer.
 */

interface PendingAnswer {
    dueAt: number;
    send: () => void;
}

export class AnswerQueue {
    private pending: PendingAnswer[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private getDelayMs: () => number) {}

    schedule(send: () => void): void {
        const last = this.pending[this.pending.length - 1];
        const dueAt = Math.max(Date.now() + this.getDelayMs(), last ? last.dueAt : 0);
        this.pending.push({ dueAt, send });
        this.flush();
    }

    /** Drops every pending answer: the connection that was to receive them is gone or offline. */
    dropAll(): void {
        this.pending = [];
        this.clearTimer();
    }

    private flush(): void {
        this.clearTimer();
        const now = Date.now();
        while (this.pending.length > 0 && this.pending[0].dueAt <= now) {
            this.pending.shift()!.send();
        }
        if (this.pending.length > 0) {
            this.timer = setTimeout(() => this.flush(), this.pending[0].dueAt - now);
        }
    }

    private clearTimer(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }
}
