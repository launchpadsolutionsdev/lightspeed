// ==================== DRAFT ASSISTANT KNOWLEDGE BASE ====================
// This file contains examples and guidelines for generating content
// Last updated: January 2026

const DRAFT_KNOWLEDGE_BASE = {
    // ==================== BRAND GUIDELINES ====================
    brandGuidelines: {
        terminology: {
            correct: ["Grand Prize", "Deadline", "Live"],
            incorrect: ["jackpot", "ends", "starts"],
            notes: [
                "NEVER use 'jackpot' - always use 'Grand Prize'",
                "Use 'Deadline' instead of 'ends'",
                "Use 'Live' instead of 'starts'"
            ]
        },
        formatting: {
            emojis: {
                maxPerPost: 2,
                placement: "One emoji max at end of sentence",
                note: "Use sparingly and appropriately"
            },
            socialPosts: {
                structure: "Short paragraph form with line breaks between paragraphs",
                disclaimer: "All social posts MUST include licence disclaimer at end"
            },
            emails: {
                note: "These are for email copy, not full email templates with headers/footers",
                format: "Keep concise and action-oriented"
            }
        },
        website: "www.thunderbay5050.ca",
        store: "Thunder Bay 50/50 store inside Intercity Shopping Centre",
        requirements: "Must be 18+ and in Ontario to play"
    },

    // ==================== SOCIAL MEDIA EXAMPLES ====================
    socialMedia: {
        description: "Social media posts for Facebook, Instagram, and other platforms",
        guidelines: [
            "Short paragraph form with line breaks",
            "Maximum 2 emojis per post",
            "Always include licence disclaimer at end",
            "Never use 'jackpot' - use 'Grand Prize'",
            "ALWAYS include this line: 'Purchase tickets online at www.thunderbay5050.ca or at the Thunder Bay 50/50 store inside the Intercity Shopping Centre!'"
        ],
        requiredLine: "Purchase tickets online at www.thunderbay5050.ca or at the Thunder Bay 50/50 store inside the Intercity Shopping Centre!",
        examples: [
            {
                type: "General Promotion",
                content: `This week's Early Birds are LIVE, and there's a whole lotta loot up for grabs 💰

Monday, Tuesday and Thursday you can win $5,000. Wednesday's prize is $10,000!

A $20 ticket gets you 30 numbers in every draw – that's the Early Birds AND the $5,000+ Grand Prize on November 28.

Get tickets: www.thunderbay5050.ca

Licence #RAF1296922`
            },
            {
                type: "Winner Announcement",
                content: `A BIG congratulations to Bernice, our $5,000 Early Bird #1 winner! 🎉

Get your tickets at www.thunderbay5050.ca for chances at our remaining Early Birds and the Grand Prize draw on November 28.

Licence #RAF1296922`
            },
            {
                type: "Draw Reminder",
                content: `There are only 2 days left to get your Thunder Bay 50/50 October tickets for tomorrow's Grand Prize draw.

This is the last day to get your tickets in time for tomorrow's Grand Prize.

The Grand Prize is currently sitting at $201,080, guaranteed to be AT LEAST $250,000.

$20 = 30 chances to win!

Get tickets: www.thunderbay5050.ca

Licence #RAF1296922`
            },
            {
                type: "Early Bird Focus",
                content: `This week's Early Bird schedule is LIVE 🎉

Wed, Feb 5: Early Bird #1 – $10,000
Thu, Feb 6: Early Birds #2-6 – 5 x $5,000 prizes
Fri, Feb 7: Early Birds #7-9 – 3 x $10,000 prizes
Sat, Feb 8: Early Bird #10 – $25,000!

Get your February tickets now at www.thunderbay5050.ca for your shot at over $100,000 in Early Bird prizes PLUS the Grand Prize on February 27.

Licence #RAF1296922`
            },
            {
                type: "Milestone/Record",
                content: `🚨 THUNDER BAY 50/50 RECORD ALERT 🚨

The Grand Prize has hit $3 MILLION – a new record!

There's still time to get your tickets before Friday's deadline.

Get tickets: www.thunderbay5050.ca

Licence #RAF1296922`
            }
        ]
    },

    // ==================== EMAIL: NEW DRAW ANNOUNCEMENT ====================
    emailNewDraw: {
        description: "Emails announcing a new monthly draw has started",
        guidelines: [
            "Announce the new draw month and number",
            "Highlight the Early Bird prize schedule",
            "Include Grand Prize date and minimum guarantee",
            "Create excitement for the new draw"
        ],
        examples: [
            {
                subject: "February Draw is LIVE – Over $100K in Early Birds!",
                content: `The Thunder Bay 50/50 February draw is officially LIVE! 🎉

This month features over $100,000 in Early Bird prizes leading up to the Grand Prize draw on February 27.

Early Bird Schedule:
• Wed, Feb 5: $10,000
• Thu, Feb 6: 5 x $5,000
• Fri, Feb 7: 3 x $10,000
• Sat, Feb 8: $25,000

The Grand Prize is guaranteed to be at least $5,000 (50% of ticket sales).

Get your February tickets now at www.thunderbay5050.ca

Good luck!`
            },
            {
                subject: "March Draw Now Open – First Early Bird Wednesday!",
                content: `The March Thunder Bay 50/50 draw is now open!

Our first Early Bird draw is this Wednesday, March 5 for $10,000.

This month we have 15 Early Bird draws totaling over $100,000 in prizes, plus the Grand Prize draw on March 27.

A $20 ticket gets you 30 numbers in every single draw – that's all the Early Birds AND the Grand Prize.

Get your tickets: www.thunderbay5050.ca`
            },
            {
                subject: "New Year, New Draw – January 50/50 is LIVE",
                content: `Happy New Year! The January Thunder Bay 50/50 draw is officially open.

Start the year with a chance to win big! Our Early Bird draws begin next week with prizes ranging from $5,000 to $25,000.

The Grand Prize draw is January 30, with a guaranteed minimum of $5,000.

Get your January tickets at www.thunderbay5050.ca`
            }
        ]
    },

    // ==================== EMAIL: DRAW REMINDER ====================
    emailDrawReminder: {
        description: "Emails reminding supporters about upcoming draws or deadlines",
        guidelines: [
            "Create urgency around the deadline",
            "Mention current Grand Prize amount if significant",
            "Highlight what they'll miss if they don't buy",
            "Keep it concise and action-oriented"
        ],
        examples: [
            {
                subject: "⏰ 2 Days Left – Grand Prize Draw Friday",
                content: `There are only 2 days left to get your Thunder Bay 50/50 tickets!

The Grand Prize draw is this Friday at 11:00 AM. The prize is currently over $200,000 and growing.

Don't miss your chance – get your tickets before the deadline:
www.thunderbay5050.ca`
            },
            {
                subject: "Tomorrow's Early Bird: $25,000!",
                content: `Tomorrow is our biggest Early Bird of the month – $25,000!

Make sure you have your tickets before tomorrow's draw at 11:00 AM.

A $20 ticket gets you 30 chances to win.

Get tickets: www.thunderbay5050.ca`
            },
            {
                subject: "Last Week for February Tickets",
                content: `This is the final week to get your February Thunder Bay 50/50 tickets.

We still have 3 Early Bird draws remaining this week, plus the Grand Prize draw on Thursday.

Current Grand Prize: $180,000+

Get your tickets: www.thunderbay5050.ca`
            }
        ]
    },

    // ==================== EMAIL: WINNERS ANNOUNCEMENT ====================
    emailWinners: {
        description: "Emails announcing draw winners",
        guidelines: [
            "Celebrate the winner (use first name only for privacy)",
            "Mention the prize amount and draw type",
            "Encourage continued participation",
            "Build excitement for upcoming draws"
        ],
        examples: [
            {
                subject: "Congratulations to Our $2.1 Million Winner!",
                content: `We have a winner! 🎉

Congratulations to Sarah from Thunder Bay, who won $2,147,890 in our November Grand Prize draw!

Thank you to everyone who participated. Your support helps fund life-saving equipment at Thunder Bay Regional Health Sciences Centre.

The December draw is now open – get your tickets at www.thunderbay5050.ca`
            },
            {
                subject: "Early Bird Winner: $10,000!",
                content: `Congratulations to Mike, our $10,000 Early Bird winner!

There are still more Early Birds to come this month, plus the Grand Prize draw on February 27.

Get your tickets for your chance to win: www.thunderbay5050.ca`
            },
            {
                subject: "December Grand Prize: $7.7 MILLION Winner!",
                content: `RECORD-BREAKING NEWS! 🎉

Congratulations to Patrick from Timmins, who just won $7,708,290 – our biggest Grand Prize EVER!

This incredible prize was made possible by supporters like you. Thank you for playing and supporting healthcare in our region.

The January draw is now open. Could you be our next big winner?

Get tickets: www.thunderbay5050.ca`
            }
        ]
    },

    // ==================== EMAIL: IMPACT SUNDAY ====================
    emailImpactSunday: {
        description: "Sunday emails highlighting the impact of 50/50 proceeds on healthcare",
        guidelines: [
            "Focus on the healthcare impact, not ticket sales",
            "Condense/shorten the context provided by the user - don't add to it",
            "Make the connection between playing and helping",
            "Keep it heartfelt but concise"
        ],
        examples: [
            {
                subject: "Your Impact: New MRI Technology",
                content: `Every Thunder Bay 50/50 ticket helps fund life-saving equipment at our hospital.

Thanks to your support, the Thunder Bay Regional Health Sciences Foundation recently funded a new MRI machine that will help doctors diagnose conditions faster and more accurately.

This technology will serve thousands of patients in our region every year.

Thank you for playing and making a difference in our community.`
            }
        ]
    },

    // ==================== EMAIL: LAST CHANCE ====================
    emailLastChance: {
        description: "Final reminder emails before draw deadlines",
        guidelines: [
            "Maximum urgency - this is the final reminder",
            "Clear deadline (date and time)",
            "Current Grand Prize amount",
            "Simple, direct call to action"
        ],
        examples: [
            {
                subject: "🚨 FINAL HOURS – Grand Prize Draw Tomorrow",
                content: `This is it – your last chance to get Thunder Bay 50/50 tickets!

The Grand Prize draw is TOMORROW at 11:00 AM.

Current Grand Prize: $2,547,890

Ticket sales close tonight at 11:59 PM.

Get your tickets NOW: www.thunderbay5050.ca`
            },
            {
                subject: "⏰ Hours Left – Don't Miss the $3M Grand Prize",
                content: `FINAL REMINDER: Ticket sales close TONIGHT!

The Grand Prize has hit $3 MILLION – our biggest ever!

Tomorrow's winner could be you, but only if you get your tickets before midnight.

www.thunderbay5050.ca`
            },
            {
                subject: "Last Call for February Tickets",
                content: `This is your last chance to get February Thunder Bay 50/50 tickets.

Sales close tonight at 11:59 PM. The Grand Prize draw is tomorrow at 11:00 AM.

Don't miss out: www.thunderbay5050.ca`
            }
        ]
    },

    // ==================== MEDIA RELEASES ====================
    mediaRelease: {
        description: "Press releases for media distribution",
        guidelines: [
            "Professional, journalistic tone",
            "Include quotes from Glenn Craig (President & CEO) and/or other stakeholders",
            "Lead with the most newsworthy information",
            "Include full contact information and boilerplate",
            "Use proper media release formatting"
        ],
        examples: [
            {
                type: "Grand Prize Winner Announcement",
                headline: "Record-Breaking December 50/50 Delivers $7.7M Win for Timmins Resident",
                content: `FOR IMMEDIATE RELEASE

THUNDER BAY, ON – The Thunder Bay Regional Health Sciences Foundation has announced that Patrick Chilton of Timmins is the winner of the December Thunder Bay 50/50 Grand Prize – a record-breaking $7,708,290.

"This is an extraordinary moment for our 50/50 program," said Glenn Craig, President & CEO of the Thunder Bay Regional Health Sciences Foundation. "Patrick's win represents the largest prize in our history, and it's a testament to the incredible support we receive from communities across Northern Ontario."

The December draw saw unprecedented participation, with ticket sales reaching new heights. The 50/50 program has now generated over $50 million in proceeds for healthcare equipment and programs at Thunder Bay Regional Health Sciences Centre.

"I still can't believe it," said Chilton. "I've been playing for a while, but I never imagined winning something like this."

The January draw is now open, with tickets available at www.thunderbay5050.ca.

About Thunder Bay Regional Health Sciences Foundation
The Thunder Bay Regional Health Sciences Foundation raises funds to support Thunder Bay Regional Health Sciences Centre, Northwestern Ontario's largest hospital. The Foundation's 50/50 program is one of the most successful hospital lotteries in Canada.

-30-

Media Contact:
Torin Gunnell
Communications Officer
Thunder Bay Regional Health Sciences Foundation
tgunnell@tbrhsc.net`
            },
            {
                type: "Grand Prize Winner Announcement",
                headline: "Hanmer Couple Wins Over $2 Million in Thunder Bay 50/50 September Draw",
                content: `FOR IMMEDIATE RELEASE

THUNDER BAY, ON – Real and Rita Dallaire of Hanmer, Ontario are the lucky winners of the September Thunder Bay 50/50 Grand Prize, taking home an incredible $2,116,498.

"We are thrilled to congratulate Real and Rita on this life-changing win," said Glenn Craig, President & CEO of the Thunder Bay Regional Health Sciences Foundation. "Their support, along with thousands of others who purchased tickets, is helping us fund critical healthcare equipment and programs for our region."

The Dallaires purchased their winning ticket online at www.thunderbay5050.ca. The September draw saw strong participation from supporters across Ontario.

"We play every month," said Real Dallaire. "We love knowing that our tickets help the hospital, and now this happens. It's unbelievable."

The Thunder Bay 50/50 has generated millions of dollars for healthcare in Northwestern Ontario since its launch. Proceeds support the purchase of medical equipment, technology upgrades, and patient care programs at Thunder Bay Regional Health Sciences Centre.

The October draw is now open, with tickets available at www.thunderbay5050.ca.

-30-

Media Contact:
Torin Gunnell
Communications Officer
Thunder Bay Regional Health Sciences Foundation
tgunnell@tbrhsc.net`
            },
            {
                type: "Program/Store Announcement",
                headline: "Thunder Bay 50/50 Store Secures Long-Term Home Inside Intercity Shopping Centre",
                content: `FOR IMMEDIATE RELEASE

THUNDER BAY, ON – The Thunder Bay Regional Health Sciences Foundation is pleased to announce that the Thunder Bay 50/50 store has secured a long-term location inside Intercity Shopping Centre.

"This is a significant milestone for our 50/50 program," said Glenn Craig, President & CEO of the Thunder Bay Regional Health Sciences Foundation. "Having a permanent presence in Intercity gives our supporters a convenient location to purchase tickets and learn about the impact of their support."

The store, located near the food court entrance, offers in-person ticket sales during mall hours. Staff and volunteers are on hand to assist customers and answer questions about the program.

"We've seen tremendous support from shoppers at Intercity," said Torin Gunnell, Communications Officer for the Foundation. "Many people stop by regularly to get their monthly tickets, and it's been a great way to connect with our community."

The Thunder Bay 50/50 remains one of the most successful hospital lotteries in Canada, generating millions of dollars annually for healthcare equipment and programs at Thunder Bay Regional Health Sciences Centre.

Tickets are available in-store at Intercity Shopping Centre or online at www.thunderbay5050.ca.

-30-

Media Contact:
Torin Gunnell
Communications Officer
Thunder Bay Regional Health Sciences Foundation
tgunnell@tbrhsc.net`
            },
            {
                type: "Foundation Impact Announcement",
                headline: "Hospital Foundation Makes Largest Gift in Its History to Support Local Healthcare",
                content: `FOR IMMEDIATE RELEASE

THUNDER BAY, ON – The Thunder Bay Regional Health Sciences Foundation has announced a historic $22.8 million grant to Thunder Bay Regional Health Sciences Centre – the largest single gift in the Foundation's history.

"This represents a transformational investment in healthcare for Northwestern Ontario," said Glenn Craig, President & CEO of the Thunder Bay Regional Health Sciences Foundation. "This funding will support critical equipment purchases, technology upgrades, and programs that will benefit patients for years to come."

The grant was made possible through the Foundation's various fundraising programs, including the highly successful Thunder Bay 50/50, donor contributions, and investment returns.

"Our community's generosity is truly remarkable," said Craig. "Every ticket purchased, every donation made, contributes to moments like this – where we can make a significant impact on the quality of care available in our region."

The funding will support multiple priority areas at the Health Sciences Centre, including diagnostic imaging equipment, surgical technology, and patient care programs.

-30-

Media Contact:
Torin Gunnell
Communications Officer
Thunder Bay Regional Health Sciences Foundation
tgunnell@tbrhsc.net`
            },
            {
                type: "Media Advisory",
                headline: "MEDIA ADVISORY: Thunder Bay 50/50 Grand Prize Exceeds $2.5 Million Guarantee in Record Time",
                content: `MEDIA ADVISORY
FOR IMMEDIATE RELEASE

THUNDER BAY, ON – The Thunder Bay 50/50 December Grand Prize has exceeded its $2.5 million guarantee in record time, with ticket sales continuing to climb.

WHAT: Thunder Bay 50/50 December Grand Prize milestone announcement

DETAILS:
• The Grand Prize has surpassed $2.5 million with days still remaining before the draw
• This marks the fastest the program has reached this milestone
• Final prize amount will be determined by total ticket sales (50% of proceeds)

DRAW DATE: [Date] at 11:00 AM

WHERE TO PURCHASE: www.thunderbay5050.ca or at the Thunder Bay 50/50 store in Intercity Shopping Centre

QUOTE: "The response from our supporters has been incredible," said Glenn Craig, President & CEO of the Thunder Bay Regional Health Sciences Foundation. "We're on track for one of our biggest Grand Prizes ever."

-30-

Media Contact:
Torin Gunnell
Communications Officer
Thunder Bay Regional Health Sciences Foundation
tgunnell@tbrhsc.net`
            }
        ]
    },

    // ==================== EMAIL ADD-ONS ====================
    emailAddOns: {
        subscriptions: {
            name: "Subscriptions",
            description: "Information about Thunder Bay 50/50 subscription options",
            content: `Did you know you can subscribe to the Thunder Bay 50/50? Never miss a draw! Set up a monthly subscription and your tickets are automatically purchased each month. Visit www.thunderbay5050.ca to set up your subscription today!`
        },
        rewardsPlus: {
            name: "Rewards+",
            description: "Information about the Rewards+ program",
            content: `Join Rewards+ and earn points with every ticket purchase! Redeem your points for bonus entries, exclusive merchandise, and more. Sign up at www.thunderbay5050.ca!`
        },
        catchTheAce: {
            name: "Thunder Bay Catch The Ace",
            description: "Information about the Catch The Ace lottery",
            content: `The Thunder Bay Catch The Ace is LIVE! You LOVE the Thunder Bay 50/50, so you might love our other raffles too! The Thunder Bay Catch The Ace is a weekly progressive lottery that supports the Our Hearts at Home Campaign to bring Cardiovascular Surgery to Northwestern Ontario! We've awarded over $500,000 in prizes so far, come see what the fun is all about at www.thunderbaycatchtheace.ca!`
        }
    },

    // ==================== FACEBOOK/INSTAGRAM ADS ====================
    socialAds: {
        description: "Paid advertisement copy for Facebook and Instagram",
        guidelines: [
            "Very concise - ads need to grab attention quickly",
            "Clear call to action",
            "Include key selling points (price, odds, prize)",
            "Must include licence disclaimer"
        ],
        examples: [
            {
                type: "Value Proposition",
                headline: "30 Chances to Win for Just $20",
                content: `Support healthcare. Win big.

$20 = 30 numbers in EVERY draw this month.

That's Early Birds AND the Grand Prize.

Get tickets: www.thunderbay5050.ca

Licence #RAF1296922`
            },
            {
                type: "Grand Prize Focus",
                headline: "Grand Prize Over $2 Million",
                content: `The Thunder Bay 50/50 Grand Prize is over $2 MILLION.

Could you be our next big winner?

Tickets from $10 at www.thunderbay5050.ca

Licence #RAF1296922`
            },
            {
                type: "Early Bird Focus",
                headline: "$25,000 Early Bird This Saturday",
                content: `This Saturday: $25,000 Early Bird draw!

Every ticket this month includes chances at ALL Early Birds plus the Grand Prize.

www.thunderbay5050.ca

Licence #RAF1296922`
            },
            {
                type: "Impact Message",
                headline: "Win Big. Help Local Healthcare.",
                content: `Every Thunder Bay 50/50 ticket supports life-saving equipment at our hospital.

Plus, you could win the Grand Prize!

Tickets: www.thunderbay5050.ca

Licence #RAF1296922`
            },
            {
                type: "Urgency/Deadline",
                headline: "Last Chance – Draw Tomorrow!",
                content: `⏰ Ticket sales close TONIGHT!

The Grand Prize draw is tomorrow. Don't miss your chance.

Get tickets NOW: www.thunderbay5050.ca

Licence #RAF1296922`
            }
        ]
    },

    // ==================== HELPER FUNCTIONS ====================

    // Get examples for a specific content type
    getExamples: function(contentType) {
        const mapping = {
            'social': this.socialMedia.examples,
            'social-media': this.socialMedia.examples,
            'email-new-draw': this.emailNewDraw.examples,
            'email-reminder': this.emailDrawReminder.examples,
            'email-winners': this.emailWinners.examples,
            'email-impact': this.emailImpactSunday.examples,
            'email-last-chance': this.emailLastChance.examples,
            'media-release': this.mediaRelease.examples,
            'ads': this.socialAds.examples,
            'social-ads': this.socialAds.examples
        };
        return mapping[contentType] || [];
    },

    // Get guidelines for a specific content type
    getGuidelines: function(contentType) {
        const mapping = {
            'social': this.socialMedia.guidelines,
            'social-media': this.socialMedia.guidelines,
            'email-new-draw': this.emailNewDraw.guidelines,
            'email-reminder': this.emailDrawReminder.guidelines,
            'email-winners': this.emailWinners.guidelines,
            'email-impact': this.emailImpactSunday.guidelines,
            'email-last-chance': this.emailLastChance.guidelines,
            'media-release': this.mediaRelease.guidelines,
            'ads': this.socialAds.guidelines,
            'social-ads': this.socialAds.guidelines
        };
        return mapping[contentType] || [];
    },

    // Format examples for AI prompt
    formatExamplesForPrompt: function(contentType, maxExamples = 3) {
        const examples = this.getExamples(contentType);
        if (!examples || examples.length === 0) return '';

        let formatted = '\n\nEXAMPLES:\n';
        const selected = examples.slice(0, maxExamples);

        selected.forEach((example, index) => {
            formatted += `\n--- Example ${index + 1} ---\n`;
            if (example.subject) {
                formatted += `Subject: ${example.subject}\n`;
            }
            if (example.headline) {
                formatted += `Headline: ${example.headline}\n`;
            }
            if (example.type) {
                formatted += `Type: ${example.type}\n`;
            }
            formatted += `${example.content}\n`;
        });

        return formatted;
    },

    // Get brand guidelines as formatted string
    getBrandGuidelinesPrompt: function() {
        return `
BRAND GUIDELINES:
- NEVER use "jackpot" - always use "Grand Prize"
- Use "Deadline" instead of "ends"
- Use "Live" instead of "starts"
- Website: ${this.brandGuidelines.website}
- Store: ${this.brandGuidelines.store}
- Requirements: ${this.brandGuidelines.requirements}

FORMATTING:
- Maximum 2 emojis per social post (one at end of sentence)
- Social posts: short paragraph form with line breaks
- All social posts must include licence disclaimer at end
- Emails are for copy content only (not full templates with headers)
`;
    },

    // Get social media required line
    getSocialMediaRequiredLine: function() {
        return this.socialMedia.requiredLine;
    },

    // Get email add-on content
    getEmailAddOn: function(type) {
        if (type === 'subscriptions') return this.emailAddOns.subscriptions.content;
        if (type === 'rewards-plus') return this.emailAddOns.rewardsPlus.content;
        if (type === 'catch-the-ace') return this.emailAddOns.catchTheAce.content;
        return '';
    }
};

// Make it available globally
if (typeof window !== 'undefined') {
    window.DRAFT_KNOWLEDGE_BASE = DRAFT_KNOWLEDGE_BASE;
}
