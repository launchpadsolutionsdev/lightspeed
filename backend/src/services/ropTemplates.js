/**
 * Rules of Play Reference Templates
 * Gold-standard structural templates for each raffle type (Ontario).
 * Injected into the AI system prompt to guide document generation.
 */

const TEMPLATE_5050 = `REFERENCE TEMPLATE — 50/50 LOTTERY (Ontario)

OFFICIAL RULES
RULES OF PLAY FOR DRAWS #[FIRST]-[LAST]
License [LICENSE NUMBER]

1. Players must be at least 18 years of age to purchase tickets in this lottery.
2. [Organization Name] is using [Electronic Raffle System Provider], an electronic raffle system, to run this lottery.
3. Ticket purchasers must be physically located within the province of Ontario at the time of purchase.
4. Tickets for all draws will be available for purchase online at [URL] and at [Physical Location(s)].
5. Ticket pricing: [Pricing Tiers — e.g., "$10 for 5 numbers, $20 for 30 numbers, $50 for 150 numbers, $100 for 400 numbers"]
6. [Early Bird deadline rules — e.g., "All ticket purchases made during the sales period are eligible for the Early Bird draw(s) within that draw period. Purchasers must have bought their tickets before the applicable Early Bird deadline."]

DRAW SCHEDULE:

[Repeating block for each draw:]

DRAW #[N]:
- Sales Period: [Start Date] to [End Date]
- Draw Date: [Date and Time], EST
- The winning prize will be half (50%) of the total ticket sales for Draw #[N].
- Guaranteed Minimum Prize: $[Amount]
- When Ticket Sales are less than $[Threshold], the prize will be the Guaranteed Minimum of $[Amount].
- When Ticket Sales exceed $[Threshold], the winner receives 50% of total sales.
- [Draw-specific pricing overrides if applicable]

Early Bird Draw(s) for Draw #[N]:
- Early Bird #[X]: [Date] — [Prize Description, e.g., "5 x $5,000 cash prizes"]
- Early Bird Deadline: [Date/Time]

[End repeating block]

TICKET INFORMATION:
- Tickets are delivered as a receipt with registered number(s) assigned via Random Number Generation (RNG).
- Purchasers cannot choose specific numbers.
- There is no limit on the number of tickets that can be sold per draw.

INELIGIBLE PERSONS:
The following persons are NOT eligible to purchase tickets or win prizes:
- [Group 1 — e.g., "Staff and Board of Directors of [Organization], as well as family members living in the same household"]
- [Group 2 — e.g., "Employees of [Electronic Raffle System Provider] and its affiliates"]
- [Group 3 — e.g., "Any individual involved in the operation, administration, or promotion of this lottery"]
- Volunteers of [Organization] ARE eligible to purchase tickets and win prizes.
- Any ticket purchased by an ineligible person will be considered void, and no prize will be awarded.

WINNER NOTIFICATION & PRIZE CLAIMING:
- Winners will be notified by telephone using the contact information provided at the time of ticket purchase.
- Winning numbers will be posted on [Website URL].
- To claim a prize, winners must provide: name, address, phone number, and valid government-issued photo identification.
- Prizes will be paid by cheque representing 50% of the total ticket sales for the applicable draw.
- Prize claim period: 6 months from the date of the draw.
- Unclaimed prizes will be donated to a local charity with the approval of the Alcohol and Gaming Commission of Ontario (AGCO).

CONTACT:
- Phone: [Phone Number]
- Email: [Email Address]
- Website: [URL]

RESPONSIBLE GAMBLING:
Play responsibly: Set a limit and stick to it.
Problem Gambling Helpline / ConnexOntario: 1-866-531-2600

SUBSCRIPTION TERMS (if applicable):
- Monthly subscription available: subscribers are automatically entered into each draw.
- Subscriptions can be cancelled at any time via the account portal or by contacting [Email].
- If a payment method is declined, the subscription will be automatically cancelled.
- [Subscription bonus for Early Bird winners — e.g., "Active subscribers who win an Early Bird prize receive a $1,000 bonus."]`;

const TEMPLATE_CATCH_THE_ACE = `REFERENCE TEMPLATE — CATCH THE ACE (Ontario)

Rules of Play: [Raffle Name]

ELIGIBILITY
- Players must be at least 18 years of age.
- Ticket purchasers must be physically located within the province of Ontario at the time of purchase.
- The following persons are NOT eligible to purchase tickets or win prizes:
  - [Group 1 — e.g., "Members of [Organization]'s Board of Directors and their immediate family members living in the same household"]
  - [Group 2 — e.g., "Employees of [Organization] and their immediate family members"]
  - [Group 3 — e.g., "Employees of [Electronic Raffle System Provider] and its affiliates"]
  - Volunteers ARE eligible to participate.

TICKET SALES
- Tickets available online at [URL].
- Sales open each [Day, e.g., "Tuesday"] at [Time, e.g., "9:00 AM EST"] following the previous week's draw.
- Sales close each [Day, e.g., "Monday"] at [Time, e.g., "11:59 PM EST"].
- Ticket pricing: [Tiers — e.g., "2 for $5, 5 for $10, 25 for $20, 100 for $50"]
- Each ticket purchase entitles the purchaser to select ONE virtual envelope, regardless of how many tickets are purchased.
- There is no limit on the number of tickets a person may purchase per week.
- Tickets are delivered via email confirmation.

DRAWS, PRIZES, & WINNERS
- A draw is held every [Day] at [Time, e.g., "Tuesday at 9:00 AM EST"] via Random Number Generation (RNG).
- The weekly winner receives [Weekly Prize %]% of that week's ticket sales.
- The weekly winner's selected envelope is then revealed:
  - If the Ace of Spades is revealed: the winner ALSO receives the Progressive Jackpot, which is [Jackpot %]% of ALL cumulative ticket sales across all weeks.
  - If any other card is revealed: [Jackpot %]% of that week's sales is added to the Progressive Jackpot, and the raffle continues the following week with one fewer envelope.
- Guaranteed Minimum Jackpot: $[Amount] (if the Ace of Spades is found before the jackpot reaches this amount, [Organization] will supplement the difference).
- Draw results are posted on [Website URL] and winners are notified by phone.
- Prize claim period: 6 months from the date of the draw.
- Winners must provide: name, address, phone number, and valid government-issued photo identification.
- Winners do not need to be present at the time of the draw.

GENERAL RULES
- By purchasing a ticket, purchasers acknowledge and agree to these Rules of Play.
- [Electronic Raffle System Provider] is used for order processing and electronic ticket management.
- [Organization]'s liability is limited to the price of the ticket purchased.

PRIVACY
- By accepting a prize, winners consent to the use of their name, likeness, photograph, municipality of residence, and audio/video recordings for promotional purposes by [Organization].
- [Organization] will not sell, rent, or share personal information with third parties for marketing purposes.

SUBSCRIPTIONS
- Weekly auto-purchase subscriptions are available.
- Subscriptions continue automatically until the raffle concludes or the subscriber cancels.
- If a subscriber's selected envelope is revealed during a draw, they will be automatically assigned the next available envelope.
- Subscribers can cancel at any time via the account portal or by emailing [Email].
- If a payment method is declined, the subscription will be automatically cancelled.

LICENSE INFORMATION
- License Number: [Number]
- Regulatory Body: Alcohol and Gaming Commission of Ontario (AGCO)
- Play responsibly: Set a limit and stick to it.
- Problem Gambling Helpline / ConnexOntario: 1-866-531-2600`;

const TEMPLATE_PRIZE_RAFFLE = `REFERENCE TEMPLATE — PRIZE RAFFLE (Ontario)

OFFICIAL RULES
License [LICENSE NUMBER]

1. Players must be at least 18 years of age to purchase tickets in this lottery.
2. [Organization Name] is using [Electronic Raffle System Provider], an electronic raffle system, to run this lottery.
3. Ticket purchasers must be physically located within the province of Ontario at the time of purchase.
4. Tickets will be available for purchase online at [URL] and at [Physical Location(s)].
5. A maximum of [Maximum Tickets] tickets will be sold.
6. [Early Bird deadline rules]

DRAW SCHEDULE:

[Draw Name — e.g., "[Organization] [Year] [Prize] Raffle"]:
- Sales Period: [Start Date] to [End Date]
- Draw Date: [Date and Time], EST
- Grand Prize: [Detailed prize description, e.g., "2025 Jeep Wrangler Willys 4-Door, VIN #[number], in [color], valued at $[value]"]
- Declared Value: $[Value]

Early Bird Draw(s):
- Early Bird #1: [Date] — [Prize, e.g., "$2,500 cash"]
- Early Bird #2: [Date] — [Prize, e.g., "$2,500 cash"]
- Early Bird Deadline: [Date/Time]

TICKET PRICING:
- [Tier 1 — e.g., "1 ticket for $25"]
- [Tier 2 — e.g., "3 tickets for $50"]
- [Tier 3 — e.g., "8 tickets for $100"]

TICKET INFORMATION:
- Tickets are delivered as a receipt with registered number(s) assigned via Random Number Generation (RNG).
- Purchasers cannot choose specific numbers.

INELIGIBLE PERSONS:
- [Same structure as 50/50]

WINNER NOTIFICATION & PRIZE CLAIMING:
- Winners will be notified by telephone.
- Winning numbers will be posted on [Website URL].
- Prize claim period: 6 months from the date of the draw.
- Winners must provide valid government-issued photo identification.
- Unclaimed prizes will be donated to a local charity with the approval of the AGCO.

PRIZE TERMS:
- Prize Condition: The grand prize is delivered free and clear of all liens, security interests, and encumbrances.
- Winner Responsibilities After Delivery: Upon delivery, the winner assumes full responsibility for the prize, including but not limited to: insurance, licensing, registration, fuel, maintenance, applicable taxes, and any other costs associated with ownership and operation.
- Delivery & Transport: [Supplier/Dealer Name] will arrange transportation of the prize to the winner within Ontario. The winner is not required to be present at [Supplier location] for delivery.
- Dealer/Manufacturer Support: Any post-delivery warranty, service, or support matters are between the winner and [Supplier/Dealer Name].

CONTACT:
- Phone: [Phone Number]
- Email: [Email Address]
- Website: [URL]

RESPONSIBLE GAMBLING:
Play responsibly: Set a limit and stick to it.
Problem Gambling Helpline / ConnexOntario: 1-866-531-2600`;

const TEMPLATE_HOUSE_LOTTERY = `REFERENCE TEMPLATE — HOUSE LOTTERY (Ontario)

[Raffle Name] Rules of Play

By purchasing a ticket for the [Raffle Name], purchasers acknowledge and agree to these Rules of Play.

1. Players must be at least 18 years of age to purchase tickets.
2. Ticket purchasers must be physically located within the province of Ontario at the time of purchase. All prizes will be awarded in Ontario.
3. Only paid and verified tickets are eligible for all draws.
4. A maximum of [Maximum Tickets] tickets will be sold at $[Ticket Price] each, or [Multi-Pack Description, e.g., "a 3-Pack for $250"].
5. Ticket numbers are issued randomly via the electronic raffle system.
6. Group purchases are permitted; however, one individual must handle the payment and will be the sole registered ticket holder. It is the responsibility of the group to determine how the prize will be shared.
7. Ticket confirmation: Upon purchase, buyers will see a confirmation page and receive an email receipt with their ticket number(s).

EARLY BIRD DRAWS:
- Early Bird tickets must be purchased by [Deadline Date/Time] to be eligible.
- All Early Bird winners remain eligible for all subsequent Early Bird draws and the Grand Prize draw.
- Early Bird prizes are paid by cheque.
- Total Early Bird prize value: $[Total Amount]

Early Bird Draw Schedule:
- [Date]: $[Amount]
- [Date]: $[Amount]
- [Date]: $[Amount]
[Repeat as needed]

GRAND PRIZE:
- Grand Prize: [Property Address], valued at $[Value] (inclusive of HST).
- Grand Prize draw sales deadline: [Date/Time]
- Grand Prize draw: [Date, Time] at [Location Address]
- Draw method: Event Management Terminal maintained by [Electronic Raffle System Provider]
- No cash substitute is available for the Grand Prize.
- All prizes must be accepted as awarded.

PAYMENT METHODS:
Accepted payment methods: [List — e.g., "Visa, Mastercard, American Express, Discover, Diners Club, Debit Mastercard, Visa Debit, Cash/POS at [location]"]

WINNER PUBLICITY:
By accepting a prize, winners consent to the use of their name, likeness, photograph, municipality of residence, and audio/video recordings for promotional purposes by [Organization].

LIABILITY:
[Organization]'s liability is limited to the price of the ticket purchased.

INELIGIBLE PERSONS:
- [Group descriptions — e.g., "Members of [Organization], its staff, Board of Directors, and their immediate family members living in the same household"]
- Any ticket purchased by an ineligible person will be void.

TICKET RECORDS:
All ticket records are maintained in the [Electronic Raffle System] system.

RESULTS:
- Winners will be posted on [Website URL] and [Social Media].
- Complete draw results will be published on [Website URL] by [Results Deadline Date].

CONTACT:
- Phone: [Phone Number]
- Email: [Email Address]

UNCLAIMED PRIZES:
Prizes must be claimed within 6 months from the date of the draw. Unclaimed prizes will be donated to a local charity with the approval of the Alcohol and Gaming Commission of Ontario (AGCO).

LICENSE INFORMATION:
- License Number: [Number]
- Regulatory Body: Alcohol and Gaming Commission of Ontario (AGCO)

RESPONSIBLE GAMBLING:
Play responsibly: Set a limit and stick to it.
Problem Gambling Helpline / ConnexOntario: 1-866-531-2600`;

const TEMPLATES = {
    '5050': TEMPLATE_5050,
    'catch_the_ace': TEMPLATE_CATCH_THE_ACE,
    'prize_raffle': TEMPLATE_PRIZE_RAFFLE,
    'house_lottery': TEMPLATE_HOUSE_LOTTERY
};

const RAFFLE_TYPE_LABELS = {
    '5050': '50/50 Lottery',
    'catch_the_ace': 'Catch the Ace',
    'prize_raffle': 'Prize Raffle',
    'house_lottery': 'House Lottery'
};

/**
 * Build the full system prompt for Rules of Play generation.
 */
function buildSystemPrompt({ raffleType, jurisdiction, formData, referenceDocumentText }) {
    const template = TEMPLATES[raffleType];
    const typeLabel = RAFFLE_TYPE_LABELS[raffleType] || raffleType;

    let prompt = `You are a legal document generator specializing in charitable lottery and raffle Rules of Play documents for ${jurisdiction.province_state_name}, ${jurisdiction.country === 'CA' ? 'Canada' : 'United States'}.

RAFFLE TYPE: ${typeLabel}

JURISDICTION: ${jurisdiction.province_state_name}, ${jurisdiction.country === 'CA' ? 'Canada' : 'United States'}
- Regulatory body: ${jurisdiction.regulatory_body_name || 'N/A'}${jurisdiction.regulatory_body_abbreviation ? ` (${jurisdiction.regulatory_body_abbreviation})` : ''}
- Minimum age: ${jurisdiction.minimum_age}
- Geographic restriction: ${jurisdiction.geographic_restriction_text || 'N/A'}
- Unclaimed prizes: ${jurisdiction.unclaimed_prize_rule || 'N/A'}
- Responsible gambling: ${jurisdiction.responsible_gambling_org || 'N/A'} — ${jurisdiction.responsible_gambling_phone || 'N/A'}`;

    if (referenceDocumentText) {
        prompt += `\n\nREFERENCE DOCUMENT (uploaded by user — use as structural guide):\n${referenceDocumentText}`;
    }

    if (template) {
        prompt += `\n\nBUILT-IN STRUCTURAL TEMPLATE:\n${template}`;
    }

    prompt += `\n\nORGANIZATION DETAILS:\n${JSON.stringify(formData, null, 2)}`;

    prompt += `\n\nINSTRUCTIONS:
- Generate a complete, formal Rules of Play document for the specified raffle type.
- Use clear, precise legal language appropriate for ${jurisdiction.province_state_name} charitable gaming regulations${jurisdiction.regulatory_body_abbreviation ? ` under the ${jurisdiction.regulatory_body_abbreviation}` : ''}.
- Follow the structural conventions of the raffle type as shown in the built-in template above.
- Include all required jurisdiction-specific disclosures and language.
- Include responsible gambling language and helpline information.
- Use the organization's specific terminology, branding, and raffle name throughout.
- Format dates, times, and currency consistently (${jurisdiction.country === 'CA' ? 'Canadian dollars, EST/EDT' : 'US dollars, local timezone'}).
- If a reference document was provided, match its structural approach while incorporating the organization's details.
- If any information is missing that would typically appear in a document of this type, include a [NEEDS INPUT] marker with a note about what's needed.

TYPE-SPECIFIC STRUCTURAL GUIDANCE:

${getTypeGuidance(raffleType)}

OUTPUT FORMAT:
Generate the complete Rules of Play as clean, structured text. Use plain text formatting suitable for insertion into a formal document. Do not use markdown. Match the formality level and structural conventions of real ${jurisdiction.province_state_name} Rules of Play documents${jurisdiction.regulatory_body_abbreviation ? ` submitted to the ${jurisdiction.regulatory_body_abbreviation}` : ''}.`;

    return prompt;
}

function getTypeGuidance(raffleType) {
    switch (raffleType) {
        case '5050':
            return `[50/50 LOTTERY]:
- Open with "OFFICIAL RULES" header
- Include license number and draw range
- List all eligibility, sales, and pricing info as numbered/bulleted rules
- Present each draw as a separate block with full details
- Include all Early Bird draws under each draw
- Note draw-specific pricing overrides where applicable
- Include subscription terms if applicable
- Close with responsible gambling`;

        case 'catch_the_ace':
            return `[CATCH THE ACE]:
- Use section headers: Eligibility, Ticket Sales, Draws/Prizes/Winners, General Rules, Privacy, Subscriptions, License Information
- Explain the envelope/card mechanic clearly
- Detail the progressive jackpot calculation (weekly % + cumulative %)
- Include envelope re-assignment rules for subscribers
- Include privacy/publicity consent section
- Include "liability limited to ticket price" statement`;

        case 'prize_raffle':
            return `[PRIZE RAFFLE]:
- Open with "OFFICIAL RULES" header and license number
- Emphasize the maximum ticket cap
- Describe the grand prize in full detail with declared value
- Include prize condition (no encumbrances), winner responsibilities, delivery/transport terms, and dealer support
- List Early Bird prizes under the main draw`;

        case 'house_lottery':
            return `[HOUSE LOTTERY]:
- List rules as sequential statements (no section headers — more narrative style)
- Emphasize maximum ticket count and pricing prominently
- Include group purchase rules
- List all accepted payment methods
- Include winner publicity consent language
- Include property address and value (inclusive of HST)
- Specify draw location (often the property itself)
- Include "no cash substitute" and "all prizes must be accepted as awarded"
- Include "liability limited to ticket price"
- Include results publication deadline
- Close with license number and responsible gambling helpline`;

        default:
            return 'Generate the document following standard charitable lottery conventions for the jurisdiction.';
    }
}

module.exports = {
    TEMPLATES,
    RAFFLE_TYPE_LABELS,
    buildSystemPrompt
};
