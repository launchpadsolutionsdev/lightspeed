// ==================== DRAW SCHEDULE ====================
// This file contains the current month's draw schedule
// Update this file monthly when new Rules of Play are released
// Last updated: February 2026

const DRAW_SCHEDULE = {
    // Current active draw information
    currentDraw: {
        drawNumber: 5,
        name: "Draw #5 - February 2026",
        ticketSalesStart: "2026-01-30T11:30:00",
        ticketSalesEnd: "2026-02-26T23:59:00",
        grandPrizeDate: "2026-02-27T11:00:00",
        guaranteedPrize: "$5,000",
        prizeDescription: "50% of sales (minimum $5,000 guaranteed)"
    },

    // Early Bird draws for the current month
    earlyBirds: [
        {
            number: 1,
            date: "2026-02-04",
            day: "Wednesday",
            prize: "$10,000",
            quantity: 1
        },
        {
            number: "2-6",
            date: "2026-02-05",
            day: "Thursday",
            prize: "$5,000",
            quantity: 5
        },
        {
            number: "7-9",
            date: "2026-02-06",
            day: "Friday",
            prize: "$10,000",
            quantity: 3
        },
        {
            number: 10,
            date: "2026-02-07",
            day: "Saturday",
            prize: "$25,000",
            quantity: 1
        },
        {
            number: 11,
            date: "2026-02-11",
            day: "Wednesday",
            prize: "$5,000",
            quantity: 1
        },
        {
            number: 12,
            date: "2026-02-13",
            day: "Friday",
            prize: "$10,000",
            quantity: 1
        },
        {
            number: 13,
            date: "2026-02-18",
            day: "Wednesday",
            prize: "$5,000",
            quantity: 1
        },
        {
            number: 14,
            date: "2026-02-20",
            day: "Friday",
            prize: "$10,000",
            quantity: 1
        },
        {
            number: 15,
            date: "2026-02-25",
            day: "Wednesday",
            prize: "$5,000",
            quantity: 1
        }
    ],

    // Ticket pricing for this draw
    pricing: [
        { price: "$10", numbers: 5 },
        { price: "$20", numbers: 30 },
        { price: "$50", numbers: 150 },
        { price: "$75", numbers: 300 },
        { price: "$100", numbers: 500 }
    ],

    // Helper function to get upcoming draws
    getUpcomingDraws: function(fromDate = new Date()) {
        const today = new Date(fromDate);
        today.setHours(0, 0, 0, 0);

        const upcoming = [];

        // Check Early Birds
        for (const eb of this.earlyBirds) {
            const drawDate = new Date(eb.date);
            drawDate.setHours(0, 0, 0, 0);

            if (drawDate >= today) {
                const daysUntil = Math.ceil((drawDate - today) / (1000 * 60 * 60 * 24));
                upcoming.push({
                    type: "Early Bird",
                    number: eb.number,
                    date: eb.date,
                    day: eb.day,
                    prize: eb.prize,
                    quantity: eb.quantity,
                    daysUntil: daysUntil,
                    isToday: daysUntil === 0,
                    isTomorrow: daysUntil === 1
                });
            }
        }

        // Check Grand Prize
        const grandPrizeDate = new Date(this.currentDraw.grandPrizeDate);
        grandPrizeDate.setHours(0, 0, 0, 0);

        if (grandPrizeDate >= today) {
            const daysUntil = Math.ceil((grandPrizeDate - today) / (1000 * 60 * 60 * 24));
            upcoming.push({
                type: "Grand Prize",
                date: this.currentDraw.grandPrizeDate.split('T')[0],
                day: new Date(this.currentDraw.grandPrizeDate).toLocaleDateString('en-US', { weekday: 'long' }),
                prize: this.currentDraw.guaranteedPrize + " minimum (50% of sales)",
                daysUntil: daysUntil,
                isToday: daysUntil === 0,
                isTomorrow: daysUntil === 1
            });
        }

        return upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
    },

    // Get draws happening today or tomorrow (for AI prompts)
    getImminentDraws: function(fromDate = new Date()) {
        return this.getUpcomingDraws(fromDate).filter(d => d.daysUntil <= 1);
    },

    // Format draw schedule for display
    getFormattedSchedule: function() {
        let html = `<div class="draw-schedule-content">`;
        html += `<div class="draw-info-header">
            <strong>${this.currentDraw.name}</strong>
            <span class="draw-prize-badge">Grand Prize: ${this.currentDraw.guaranteedPrize}+ on ${this.formatDate(this.currentDraw.grandPrizeDate)}</span>
        </div>`;

        html += `<div class="early-bird-list">`;
        for (const eb of this.earlyBirds) {
            const isUpcoming = new Date(eb.date) >= new Date();
            const statusClass = isUpcoming ? 'upcoming' : 'passed';
            html += `<div class="early-bird-item ${statusClass}">
                <span class="eb-date">${eb.day}, ${this.formatDate(eb.date)}</span>
                <span class="eb-prize">${eb.quantity > 1 ? eb.quantity + ' x ' : ''}${eb.prize}</span>
            </div>`;
        }
        html += `</div>`;
        html += `</div>`;

        return html;
    },

    formatDate: function(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    // Generate context for AI about current draws
    getAIContext: function(fromDate = new Date()) {
        const imminent = this.getImminentDraws(fromDate);
        const upcoming = this.getUpcomingDraws(fromDate).slice(0, 5);

        let context = `CURRENT DRAW SCHEDULE (${this.currentDraw.name}):\n`;
        context += `- Grand Prize Draw: ${this.formatDate(this.currentDraw.grandPrizeDate)} at 11:00 AM (${this.currentDraw.prizeDescription})\n`;
        context += `- Ticket sales end: ${this.formatDate(this.currentDraw.ticketSalesEnd)} at 11:59 PM\n\n`;

        if (imminent.length > 0) {
            context += `⚠️ IMMINENT DRAWS (mention these if relevant!):\n`;
            for (const draw of imminent) {
                if (draw.isToday) {
                    context += `- TODAY: ${draw.type} ${draw.number ? '#' + draw.number : ''} - ${draw.prize}!\n`;
                } else if (draw.isTomorrow) {
                    context += `- TOMORROW: ${draw.type} ${draw.number ? '#' + draw.number : ''} - ${draw.prize}!\n`;
                }
            }
            context += `\n`;
        }

        context += `UPCOMING EARLY BIRD DRAWS:\n`;
        for (const eb of upcoming) {
            if (eb.type === "Early Bird") {
                context += `- ${eb.day}, ${this.formatDate(eb.date)}: Early Bird #${eb.number} - ${eb.quantity > 1 ? eb.quantity + ' x ' : ''}${eb.prize}\n`;
            }
        }

        return context;
    }
};

// Make it available globally
if (typeof window !== 'undefined') {
    window.DRAW_SCHEDULE = DRAW_SCHEDULE;
}
