// ==================== DRAFT ASSISTANT KNOWLEDGE BASE ====================
// This file contains examples and guidelines for generating content
// Generic for any charitable gaming / lottery / nonprofit organization in Ontario
// Last updated: February 2026

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
        website: "[Organization Website]",
        store: "[In-Person Ticket Location]",
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
            "ALWAYS include this line: 'Purchase tickets online at [Organization Website] or at [In-Person Ticket Location]!'"
        ],
        requiredLine: "Purchase tickets online at [Organization Website] or at [In-Person Ticket Location]!",
        examples: [
            {
                type: "General Promotion",
                content: `This week's Early Birds are LIVE, and there's a whole lotta loot up for grabs 💰

Monday, Tuesday and Thursday you can win $5,000. Wednesday's prize is $10,000!

A $20 ticket gets you 30 numbers in every draw – that's the Early Birds AND the Grand Prize on [Draw Date].

Get tickets: [Organization Website]

Licence #[Licence Number]`
            },
            {
                type: "Winner Announcement",
                content: `A BIG congratulations to [Winner First Name], our $5,000 Early Bird #1 winner! 🎉

Get your tickets at [Organization Website] for chances at our remaining Early Birds and the Grand Prize draw on [Draw Date].

Licence #[Licence Number]`
            },
            {
                type: "Draw Reminder",
                content: `There are only 2 days left to get your [Organization Name] [Month] tickets for tomorrow's Grand Prize draw.

This is the last day to get your tickets in time for tomorrow's Grand Prize.

The Grand Prize is currently sitting at $[Amount], guaranteed to be AT LEAST $[Guaranteed Minimum].

$20 = 30 chances to win!

Get tickets: [Organization Website]

Licence #[Licence Number]`
            },
            {
                type: "Early Bird Focus",
                content: `This week's Early Bird schedule is LIVE 🎉

Wed, [Date]: Early Bird #1 – $10,000
Thu, [Date]: Early Birds #2-6 – 5 x $5,000 prizes
Fri, [Date]: Early Birds #7-9 – 3 x $10,000 prizes
Sat, [Date]: Early Bird #10 – $25,000!

Get your [Month] tickets now at [Organization Website] for your shot at over $100,000 in Early Bird prizes PLUS the Grand Prize on [Grand Prize Date].

Licence #[Licence Number]`
            },
            {
                type: "Milestone/Record",
                content: `🚨 [Organization Name] RECORD ALERT 🚨

The Grand Prize has hit $[Milestone Amount] – a new record!

There's still time to get your tickets before [Day]'s deadline.

Get tickets: [Organization Website]

Licence #[Licence Number]`
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
                subject: "[Month] Draw is LIVE – Over $100K in Early Birds!",
                content: `The [Organization Name] [Month] draw is officially LIVE! 🎉

This month features over $100,000 in Early Bird prizes leading up to the Grand Prize draw on [Grand Prize Date].

Early Bird Schedule:
• [Day, Date]: $10,000
• [Day, Date]: 5 x $5,000
• [Day, Date]: 3 x $10,000
• [Day, Date]: $25,000

The Grand Prize is guaranteed to be at least $[Guaranteed Minimum] (50% of ticket sales).

Get your [Month] tickets now at [Organization Website]

Good luck!`
            },
            {
                subject: "[Month] Draw Now Open – First Early Bird [Day]!",
                content: `The [Month] [Organization Name] draw is now open!

Our first Early Bird draw is this [Day], [Date] for $10,000.

This month we have 15 Early Bird draws totaling over $100,000 in prizes, plus the Grand Prize draw on [Grand Prize Date].

A $20 ticket gets you 30 numbers in every single draw – that's all the Early Birds AND the Grand Prize.

Get your tickets: [Organization Website]`
            },
            {
                subject: "New Year, New Draw – January 50/50 is LIVE",
                content: `Happy New Year! The January [Organization Name] draw is officially open.

Start the year with a chance to win big! Our Early Bird draws begin next week with prizes ranging from $5,000 to $25,000.

The Grand Prize draw is January [Date], with a guaranteed minimum of $[Guaranteed Minimum].

Get your January tickets at [Organization Website]`
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
                subject: "⏰ 2 Days Left – Grand Prize Draw [Day]",
                content: `There are only 2 days left to get your [Organization Name] tickets!

The Grand Prize draw is this [Day] at [Draw Time]. The prize is currently over $[Current Amount] and growing.

Don't miss your chance – get your tickets before the deadline:
[Organization Website]`
            },
            {
                subject: "Tomorrow's Early Bird: $25,000!",
                content: `Tomorrow is our biggest Early Bird of the month – $25,000!

Make sure you have your tickets before tomorrow's draw at [Draw Time].

A $20 ticket gets you 30 chances to win.

Get tickets: [Organization Website]`
            },
            {
                subject: "Last Week for [Month] Tickets",
                content: `This is the final week to get your [Month] [Organization Name] tickets.

We still have 3 Early Bird draws remaining this week, plus the Grand Prize draw on [Day].

Current Grand Prize: $[Current Amount]+

Get your tickets: [Organization Website]`
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
                subject: "Congratulations to Our Grand Prize Winner!",
                content: `We have a winner! 🎉

Congratulations to [Winner First Name] from [Winner City], who won $[Prize Amount] in our [Month] Grand Prize draw!

Thank you to everyone who participated. Your support helps fund [organization's cause/mission].

The [Next Month] draw is now open – get your tickets at [Organization Website]`
            },
            {
                subject: "Early Bird Winner: $10,000!",
                content: `Congratulations to [Winner First Name], our $10,000 Early Bird winner!

There are still more Early Birds to come this month, plus the Grand Prize draw on [Grand Prize Date].

Get your tickets for your chance to win: [Organization Website]`
            },
            {
                subject: "[Month] Grand Prize: $[Prize Amount] Winner!",
                content: `RECORD-BREAKING NEWS! 🎉

Congratulations to [Winner First Name] from [Winner City], who just won $[Prize Amount] – our biggest Grand Prize EVER!

This incredible prize was made possible by supporters like you. Thank you for playing and supporting [organization's cause] in our community.

The [Next Month] draw is now open. Could you be our next big winner?

Get tickets: [Organization Website]`
            }
        ]
    },

    // ==================== EMAIL: IMPACT SUNDAY ====================
    emailImpactSunday: {
        description: "Sunday emails highlighting the impact of 50/50 proceeds on the organization's mission",
        guidelines: [
            "Focus on the community/mission impact, not ticket sales",
            "Condense/shorten the context provided by the user - don't add to it",
            "Make the connection between playing and helping",
            "Keep it heartfelt but concise"
        ],
        examples: [
            {
                subject: "Your Impact: [Impact Headline]",
                content: `Every [Organization Name] ticket helps fund [organization's cause/mission].

Thanks to your support, [Organization Name] recently funded [specific impact item or initiative] that will [describe benefit to community].

This will serve [number of beneficiaries or scope of impact] in our community every year.

Thank you for playing and making a difference.`
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
                content: `This is it – your last chance to get [Organization Name] tickets!

The Grand Prize draw is TOMORROW at [Draw Time].

Current Grand Prize: $[Current Amount]

Ticket sales close tonight at [Sales Close Time].

Get your tickets NOW: [Organization Website]`
            },
            {
                subject: "⏰ Hours Left – Don't Miss the Grand Prize",
                content: `FINAL REMINDER: Ticket sales close TONIGHT!

The Grand Prize has hit $[Current Amount] – our biggest ever!

Tomorrow's winner could be you, but only if you get your tickets before midnight.

[Organization Website]`
            },
            {
                subject: "Last Call for [Month] Tickets",
                content: `This is your last chance to get [Month] [Organization Name] tickets.

Sales close tonight at [Sales Close Time]. The Grand Prize draw is tomorrow at [Draw Time].

Don't miss out: [Organization Website]`
            }
        ]
    },

    // ==================== MEDIA RELEASES ====================
    mediaRelease: {
        description: "Press releases for media distribution",
        guidelines: [
            "Professional, journalistic tone",
            "Include quotes from organizational leadership (CEO/President) and/or other stakeholders",
            "Lead with the most newsworthy information",
            "Include full contact information and boilerplate",
            "Use proper media release formatting"
        ],
        examples: [
            {
                type: "Grand Prize Winner Announcement",
                headline: "Record-Breaking [Month] 50/50 Delivers $[Prize Amount] Win for [Winner City] Resident",
                content: `FOR IMMEDIATE RELEASE

[CITY], ON – [Organization Name] has announced that [Winner Full Name] of [Winner City] is the winner of the [Month] [Draw Program Name] Grand Prize – a record-breaking $[Prize Amount].

"This is an extraordinary moment for our 50/50 program," said [CEO/President Name], [Title] of [Organization Name]. "[Winner First Name]'s win represents the largest prize in our history, and it's a testament to the incredible support we receive from communities across Ontario."

The [Month] draw saw unprecedented participation, with ticket sales reaching new heights. The 50/50 program has now generated over $[Total Raised] in proceeds for [organization's cause/mission].

"I still can't believe it," said [Winner Last Name]. "I've been playing for a while, but I never imagined winning something like this."

The [Next Month] draw is now open, with tickets available at [Organization Website].

About [Organization Name]
[Organization boilerplate: brief description of the organization, its mission, and its 50/50 program.]

-30-

Media Contact:
[Media Contact Name]
[Media Contact Title]
[Organization Name]
[Media Contact Email]`
            },
            {
                type: "Grand Prize Winner Announcement",
                headline: "[Winner City] Resident Wins Over $[Prize Amount] in [Organization Name] [Month] Draw",
                content: `FOR IMMEDIATE RELEASE

[CITY], ON – [Winner Full Name] of [Winner City], Ontario is the lucky winner of the [Month] [Draw Program Name] Grand Prize, taking home an incredible $[Prize Amount].

"We are thrilled to congratulate [Winner First Name] on this life-changing win," said [CEO/President Name], [Title] of [Organization Name]. "Their support, along with thousands of others who purchased tickets, is helping us fund [organization's cause/mission]."

[Winner Full Name] purchased their winning ticket online at [Organization Website]. The [Month] draw saw strong participation from supporters across Ontario.

"I play every month," said [Winner First Name]. "I love knowing that my tickets help [brief mission reference], and now this happens. It's unbelievable."

[Organization Name] has generated millions of dollars for [cause area] since its launch. Proceeds support [specific areas funded by the organization].

The [Next Month] draw is now open, with tickets available at [Organization Website].

-30-

Media Contact:
[Media Contact Name]
[Media Contact Title]
[Organization Name]
[Media Contact Email]`
            },
            {
                type: "Program/Store Announcement",
                headline: "[Draw Program Name] Secures Long-Term Home at [Location Name]",
                content: `FOR IMMEDIATE RELEASE

[CITY], ON – [Organization Name] is pleased to announce that the [Draw Program Name] in-person ticket location has secured a long-term home at [Location Name].

"This is a significant milestone for our 50/50 program," said [CEO/President Name], [Title] of [Organization Name]. "Having a permanent presence at [Location Name] gives our supporters a convenient location to purchase tickets and learn about the impact of their support."

The location offers in-person ticket sales during regular hours. Staff and volunteers are on hand to assist customers and answer questions about the program.

"We've seen tremendous support from visitors at [Location Name]," said [Spokesperson Name], [Spokesperson Title] for [Organization Name]. "Many people stop by regularly to get their monthly tickets, and it's been a great way to connect with our community."

[Draw Program Name] remains one of the most successful charitable lotteries in Ontario, generating millions of dollars annually for [organization's cause/mission].

Tickets are available in-person at [Location Name] or online at [Organization Website].

-30-

Media Contact:
[Media Contact Name]
[Media Contact Title]
[Organization Name]
[Media Contact Email]`
            },
            {
                type: "Foundation Impact Announcement",
                headline: "[Organization Name] Makes Largest Gift in Its History to Support [Cause Area]",
                content: `FOR IMMEDIATE RELEASE

[CITY], ON – [Organization Name] has announced a historic $[Gift Amount] grant to [Beneficiary Organization/Program] – the largest single gift in the organization's history.

"This represents a transformational investment in [cause area] for our community," said [CEO/President Name], [Title] of [Organization Name]. "This funding will support [specific areas of impact] that will benefit [beneficiaries] for years to come."

The grant was made possible through the organization's various fundraising programs, including the highly successful [Draw Program Name], donor contributions, and investment returns.

"Our community's generosity is truly remarkable," said [CEO/President Name]. "Every ticket purchased, every donation made, contributes to moments like this – where we can make a significant impact on [cause area] in our community."

The funding will support multiple priority areas, including [list of priority areas].

-30-

Media Contact:
[Media Contact Name]
[Media Contact Title]
[Organization Name]
[Media Contact Email]`
            },
            {
                type: "Media Advisory",
                headline: "MEDIA ADVISORY: [Draw Program Name] Grand Prize Exceeds $[Guarantee Amount] Guarantee in Record Time",
                content: `MEDIA ADVISORY
FOR IMMEDIATE RELEASE

[CITY], ON – The [Draw Program Name] [Month] Grand Prize has exceeded its $[Guarantee Amount] guarantee in record time, with ticket sales continuing to climb.

WHAT: [Draw Program Name] [Month] Grand Prize milestone announcement

DETAILS:
• The Grand Prize has surpassed $[Guarantee Amount] with days still remaining before the draw
• This marks the fastest the program has reached this milestone
• Final prize amount will be determined by total ticket sales (50% of proceeds)

DRAW DATE: [Date] at [Draw Time]

WHERE TO PURCHASE: [Organization Website] or at [In-Person Ticket Location]

QUOTE: "The response from our supporters has been incredible," said [CEO/President Name], [Title] of [Organization Name]. "We're on track for one of our biggest Grand Prizes ever."

-30-

Media Contact:
[Media Contact Name]
[Media Contact Title]
[Organization Name]
[Media Contact Email]`
            }
        ]
    },

    // ==================== EMAIL ADD-ONS ====================
    emailAddOns: {
        subscriptions: {
            name: "Subscriptions",
            description: "Information about 50/50 subscription options",
            content: `Did you know you can subscribe to [Organization Name]? Never miss a draw! Set up a monthly subscription and your tickets are automatically purchased each month. Visit [Organization Website] to set up your subscription today!`
        },
        rewardsPlus: {
            name: "Rewards+",
            description: "Information about the Rewards+ program",
            content: `Join Rewards+ and earn points with every ticket purchase! Redeem your points for bonus entries, exclusive merchandise, and more. Sign up at [Organization Website]!`
        },
        catchTheAce: {
            name: "Catch The Ace",
            description: "Information about the Catch The Ace lottery",
            content: `The [Organization Name] Catch The Ace is LIVE! You LOVE the 50/50, so you might love our other raffles too! Catch The Ace is a weekly progressive lottery that supports [Catch The Ace cause/campaign]. We've awarded over $[Total Prizes Awarded] in prizes so far, come see what the fun is all about at [Catch The Ace Website]!`
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
                content: `Support [cause area]. Win big.

$20 = 30 numbers in EVERY draw this month.

That's Early Birds AND the Grand Prize.

Get tickets: [Organization Website]

Licence #[Licence Number]`
            },
            {
                type: "Grand Prize Focus",
                headline: "Grand Prize Over $[Current Amount]",
                content: `The [Organization Name] Grand Prize is over $[Current Amount].

Could you be our next big winner?

Tickets from $10 at [Organization Website]

Licence #[Licence Number]`
            },
            {
                type: "Early Bird Focus",
                headline: "$25,000 Early Bird This [Day]",
                content: `This [Day]: $25,000 Early Bird draw!

Every ticket this month includes chances at ALL Early Birds plus the Grand Prize.

[Organization Website]

Licence #[Licence Number]`
            },
            {
                type: "Impact Message",
                headline: "Win Big. Support [Cause Area].",
                content: `Every [Organization Name] ticket supports [organization's cause/mission].

Plus, you could win the Grand Prize!

Tickets: [Organization Website]

Licence #[Licence Number]`
            },
            {
                type: "Urgency/Deadline",
                headline: "Last Chance – Draw Tomorrow!",
                content: `⏰ Ticket sales close TONIGHT!

The Grand Prize draw is tomorrow. Don't miss your chance.

Get tickets NOW: [Organization Website]

Licence #[Licence Number]`
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
