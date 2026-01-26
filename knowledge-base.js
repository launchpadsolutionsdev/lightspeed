// Lightspeed by Launchpad Solutions
// Generic Knowledge Base for Hospital Lotteries & Charitable Gaming
//
// PLACEHOLDERS USED:
// [ORGANIZATION] - The lottery/charity name (e.g., "Thunder Bay Regional Health Sciences Foundation")
// [LOTTERY_NAME] - The specific lottery name (e.g., "Thunder Bay 50/50")
// [WEBSITE] - Main lottery website
// [ACCOUNT_URL] - Account management portal URL
// [SUPPORT_EMAIL] - Support email address
// [SUPPORT_PHONE] - Support phone number
// [DRAW_DAY] - Day of the week for draws (e.g., "Friday")
// [DRAW_TIME] - Time of draw (e.g., "12:00 PM EST")

const KNOWLEDGE_BASE = {
    // ==================== 50/50 LOTTERY KNOWLEDGE ====================
    "5050": [
        // ----- TICKET DELIVERY -----
        {
            id: "5050-tickets-not-received",
            keywords: ["didn't receive", "no tickets", "didn't get", "haven't received", "where are my tickets", "no email", "ticket email"],
            question: "Customer didn't receive their ticket confirmation email",
            response: `Hi there,

Thank you for reaching out and for your support of [ORGANIZATION]!

I'm sorry to hear your ticket confirmation didn't arrive. Sometimes these emails can end up in spam or junk folders, so please check there first.

If you still can't find it, I'd be happy to resend your tickets to you. Could you please confirm the email address you used when purchasing?

Rest assured that your tickets are safely registered in our system even if the email went astray.

Thank you for your patience!

Best regards`
        },
        {
            id: "5050-resend-tickets",
            keywords: ["resend", "send again", "forward tickets", "re-send", "another copy"],
            question: "Customer wants tickets resent to their email",
            response: `Hi there,

Of course! I'd be happy to resend your tickets.

I've just forwarded your ticket confirmation to the email address on file. Please check your inbox (and spam/junk folder just in case) within the next few minutes.

If you'd like me to send them to a different email address, just let me know and I'll update that for you.

Thank you for supporting [ORGANIZATION]!

Best regards`
        },
        {
            id: "5050-tickets-to-different-email",
            keywords: ["different email", "wrong email", "another email", "change email", "send to", "typo email", "misspelled email"],
            question: "Customer wants tickets sent to a different email address",
            response: `Hi there,

No problem! I can send your tickets to a different email address.

Could you please confirm the new email address you'd like me to use? Once I have that, I'll forward your ticket confirmation right away.

Just a heads up - I can also update the email on your account if you'd like to use this new address going forward. Let me know if you'd like me to make that change.

Thank you!

Best regards`
        },
        {
            id: "5050-missing-numbers",
            keywords: ["missing numbers", "can't see all numbers", "numbers cut off", "clipped", "not all numbers showing"],
            question: "Customer can't see all their ticket numbers in email",
            response: `Hi there,

Thank you for reaching out!

Due to the large number of ticket numbers, the email may clip or cut off the last few. To view all your numbers, simply click "View Entire Message" at the bottom of your email.

If you're still having trouble viewing all your numbers, let me know and I can resend your ticket confirmation.

Thank you for your support, and good luck in the draw!

Best regards`
        },

        // ----- SUBSCRIPTIONS -----
        {
            id: "5050-what-is-subscription",
            keywords: ["what is subscription", "how does subscription work", "subscription explained", "auto-renew", "automatic"],
            question: "Customer wants to understand how subscriptions work",
            response: `Hi there,

Great question! Our subscription feature makes it easy to never miss a draw.

Here's how it works:
• When you subscribe, you choose how many tickets you'd like each draw period
• Your payment method is automatically charged before each new draw
• Your tickets are purchased and emailed to you automatically
• You're entered into every draw without having to remember to buy tickets

You can cancel or modify your subscription at any time through your account at [ACCOUNT_URL], or just reach out to us and we'll help you make changes.

Would you like help setting up a subscription?

Best regards`
        },
        {
            id: "5050-how-to-subscribe",
            keywords: ["how to subscribe", "subscribe", "set up subscription", "automatic tickets", "monthly tickets"],
            question: "Customer wants to know how to subscribe",
            response: `Hi there,

Thank you for reaching out!

When you go to purchase your tickets on [WEBSITE], you'll see a checkbox option at the bottom of the page, just above the "Buy Tickets" button. Selecting this box will sign you up for a subscription.

Your tickets will then be automatically purchased and sent to you each draw period, and your payment method will be charged automatically.

Thank you for your support, and good luck in the draw!

Best regards`
        },
        {
            id: "5050-cancel-subscription",
            keywords: ["cancel subscription", "stop subscription", "unsubscribe", "stop auto", "cancel auto", "end subscription"],
            question: "Customer wants to cancel their subscription",
            response: `Hi there,

I can help you with that!

You can cancel your subscription anytime by logging into your account at [ACCOUNT_URL] and going to the subscription management section.

Alternatively, I can cancel it for you right now. Could you please confirm your account email address so I can locate your subscription?

Please note that any tickets already purchased for the current draw will remain valid - the cancellation will just prevent future automatic purchases.

Let me know how you'd like to proceed!

Best regards`
        },
        {
            id: "5050-unexpected-charge",
            keywords: ["didn't sign up", "unexpected charge", "charged but didn't", "don't remember", "automatic charge", "why was I charged", "subscribed without knowing"],
            question: "Customer doesn't remember signing up for subscription",
            response: `Hi there,

I understand how confusing an unexpected charge can be, and I'm happy to help clear this up.

When you purchase tickets on our website, there's an option to set up a subscription for automatic purchases. It's possible this was selected during a previous purchase.

Could you please provide me with the email address associated with your account? I'll look into your purchase history and subscription status right away.

If you'd like, I can cancel any active subscription and help ensure this doesn't happen again.

Thank you for your patience!

Best regards`
        },
        {
            id: "5050-modify-subscription",
            keywords: ["change subscription", "modify subscription", "different amount", "more tickets", "fewer tickets", "update subscription", "upgrade subscription"],
            question: "Customer wants to change their subscription amount",
            response: `Hi there,

Of course! You can modify your subscription at any time.

The easiest way is to log into your account at [ACCOUNT_URL] and adjust your subscription settings there.

If you'd prefer, I can make the change for you. Just let me know:
• Your account email address
• The new ticket amount you'd like for each draw

The change will take effect for the next draw period.

Let me know how I can help!

Best regards`
        },
        {
            id: "5050-duplicate-subscription",
            keywords: ["two subscriptions", "duplicate", "charged twice subscription", "subscribed twice", "double subscription"],
            question: "Customer has been subscribed twice",
            response: `Hi there,

Thank you for reaching out!

It looks like you may have accidentally subscribed twice, which explains the duplicate charges. I've gone ahead and cancelled one of the subscriptions for you. From now on, you'll only be charged once per draw period.

Thank you so much for your support, and best of luck in the draw!

Best regards`
        },

        // ----- REFUNDS & PAYMENTS -----
        {
            id: "5050-refund-request",
            keywords: ["refund", "money back", "get refund", "cancel purchase", "want refund", "wrong package"],
            question: "Customer is requesting a refund",
            response: `Hi there,

Thank you for reaching out about a refund.

As per AGCO regulations governing charitable gaming, lottery ticket purchases are generally non-refundable once the transaction is complete and tickets have been issued.

However, I'd be happy to look into your specific situation. Could you please provide:
• Your account email address
• The approximate date and amount of the purchase
• The reason for your refund request

We'll do our best to assist you!

Best regards`
        },
        {
            id: "5050-duplicate-charge",
            keywords: ["charged twice", "double charge", "duplicate charge", "two charges", "multiple charges"],
            question: "Customer believes they were charged twice",
            response: `Hi there,

I'm sorry to hear about this concern - let me look into it right away.

Could you please provide:
• Your account email address
• The date(s) of the charge(s)
• The amount(s) shown on your statement

Sometimes what appears as a duplicate charge is actually a pre-authorization hold that will disappear within a few business days. But I'll verify your account to make sure.

If there was indeed a duplicate charge, we'll get it resolved for you as quickly as possible.

Thank you for bringing this to our attention!

Best regards`
        },
        {
            id: "5050-payment-declined",
            keywords: ["payment declined", "card declined", "couldn't process", "payment failed", "transaction failed"],
            question: "Customer's payment was declined",
            response: `Hi there,

I'm sorry to hear your payment didn't go through. There are a few common reasons this can happen:

• Insufficient funds
• Card expired or card number entered incorrectly
• Your bank blocked the transaction (some banks flag lottery purchases)
• Billing address doesn't match what's on file with your bank

I'd suggest:
1. Double-checking your card details and trying again
2. Contacting your bank to ensure they're not blocking the transaction
3. Trying a different payment method if available

If you continue to have trouble, please let me know and I'll help troubleshoot further.

Best regards`
        },
        {
            id: "5050-change-credit-card",
            keywords: ["change credit card", "update payment", "new card", "change payment method", "update credit card", "payment information"],
            question: "Customer wants to update their payment method",
            response: `Hi there,

Thank you for reaching out!

You can update your payment method at any time by logging into your account at [ACCOUNT_URL].

Once logged in, navigate to your profile or account settings. From there, you'll be able to add, remove, or modify your payment methods and billing information.

If you have any trouble, please feel free to reach out and I'd be happy to assist.

Best regards`
        },

        // ----- WINNERS & DRAWS -----
        {
            id: "5050-how-to-know-if-won",
            keywords: ["did I win", "how to know", "check if won", "am I a winner", "winning numbers", "will you call", "contact winner"],
            question: "Customer wants to know how to check if they won",
            response: `Hi there,

Great question! Here's how you'll know if you've won:

If you win:
• We will contact you directly by phone using the number on your account
• You'll also receive an email notification
• We never ask winners to pay fees or provide banking info to claim prizes

To check results yourself:
• Visit [WEBSITE] after each draw to see the winning numbers
• Compare them against the ticket numbers in your confirmation email

The winning numbers are typically posted shortly after the draw concludes. But don't worry - we call all our winners, so you don't need to check manually!

Good luck!

Best regards`
        },
        {
            id: "5050-when-is-draw",
            keywords: ["when is draw", "draw date", "next draw", "when does draw happen", "draw time"],
            question: "Customer wants to know when the draw takes place",
            response: `Hi there,

Our draws take place on [DRAW_DAY] at [DRAW_TIME].

The winning numbers are posted on [WEBSITE] shortly after the draw concludes.

Remember, tickets must be purchased before the draw cutoff time to be eligible for that draw. Any tickets purchased after the cutoff will be entered into the next draw.

Is there anything else I can help you with?

Best regards`
        },
        {
            id: "5050-ticket-validity",
            keywords: ["how long valid", "ticket expire", "when expire", "validity period", "tickets good for", "still valid", "last month tickets", "old tickets", "previous tickets"],
            question: "Customer wants to know how long tickets are valid",
            response: `Hi there,

For our 50/50 lottery, tickets are valid only for the specific draw period in which they were purchased.

Unlike some lotteries where tickets carry over, each 50/50 draw is independent. This means:
• Tickets purchased for the current draw are only entered into that draw
• After the draw, those ticket numbers are no longer active
• To be entered into the next draw, you'll need to purchase new tickets

This is why many of our supporters choose to set up a subscription - it ensures you never miss a draw!

Let me know if you have any other questions.

Best regards`
        },
        {
            id: "5050-jackpot-size",
            keywords: ["jackpot", "how much", "prize amount", "pot size", "current jackpot"],
            question: "Customer wants to know the current jackpot",
            response: `Hi there,

The jackpot amount changes as more tickets are sold - the winner takes home 50% of the total pot!

For the most up-to-date jackpot amount, please visit [WEBSITE]. The jackpot counter updates in real-time as tickets are purchased.

The more tickets sold, the bigger the prize - so spread the word!

Good luck!

Best regards`
        },
        {
            id: "5050-where-winners",
            keywords: ["where are winners", "who won", "winner list", "see winners", "this month's winners"],
            question: "Customer wants to see the list of winners",
            response: `Hi there,

Thank you for reaching out!

You can view our winners by visiting [WEBSITE] and looking for the "Winners" section.

We post all our winners after each draw so you can see who's won!

We appreciate your support and good luck with the draws!

Best regards`
        },
        {
            id: "5050-odds-of-winning",
            keywords: ["odds of winning", "chances of winning", "probability", "what are the odds", "how likely"],
            question: "Customer asking about odds of winning",
            response: `Hi there,

In a 50/50 lottery, your odds of winning depend on the total number of tickets sold.

Here's how it works: each ticket has an equal chance of being drawn. So if 10,000 tickets are sold and you buy 1 ticket, your odds are 1 in 10,000. If you buy 10 tickets, your odds improve to 10 in 10,000 (or 1 in 1,000).

The exact odds vary each draw based on ticket sales, but buying more tickets does increase your chances!

Good luck!

Best regards`
        },
        {
            id: "5050-how-draw-works",
            keywords: ["how does draw work", "how do you draw", "draw process", "how is winner chosen", "is it random"],
            question: "Customer wants to know how the draw works",
            response: `Hi there,

Our lottery is licensed and regulated by the Alcohol & Gaming Commission of Ontario (AGCO).

Winners are randomly selected using an AGCO-approved electronic raffle system - the same type of system used by major sporting events and hospital raffles across Canada. Each draw is conducted under strict regulatory oversight to ensure complete fairness and transparency.

Every ticket has an equal chance of being drawn, and the process is completely random.

If you have any other questions about how the lottery works, feel free to ask!

Best regards`
        },

        // ----- ACCOUNT ISSUES -----
        {
            id: "5050-cant-login",
            keywords: ["can't login", "can't log in", "forgot password", "reset password", "locked out", "login problem"],
            question: "Customer can't log into their account",
            response: `Hi there,

I'm sorry you're having trouble accessing your account. Let me help!

To reset your password:
1. Go to [ACCOUNT_URL]
2. Click "Forgot Password" below the login fields
3. Enter your email address
4. Check your inbox for a password reset link
5. Follow the link to create a new password

If you don't receive the reset email within a few minutes, please check your spam/junk folder.

If you're still having trouble after trying these steps, let me know your account email address and I can investigate further.

Best regards`
        },
        {
            id: "5050-update-account-info",
            keywords: ["update account", "change address", "change phone", "update email", "change my info", "update contact"],
            question: "Customer wants to update their account information",
            response: `Hi there,

You can update your account information by logging into your account at [ACCOUNT_URL].

Once logged in, look for "Account Settings" or "Profile" where you can update:
• Email address
• Phone number
• Mailing address
• Payment methods

If you need help making changes or can't access your account, just let me know what you'd like updated and I can assist you directly.

Best regards`
        },
        {
            id: "5050-cant-find-purchase",
            keywords: ["can't find", "no record", "not in system", "can't locate", "no purchase found"],
            question: "Can't locate customer's purchase",
            response: `Hi there,

Thank you for reaching out. I've reviewed your request but couldn't locate any details under the name or email provided.

Could you please share:
• The last four digits of the credit card used
• Any other name or email that may have been used for the purchase
• The approximate date and amount of the purchase

This will help me look into it further for you.

We appreciate your support!

Best regards`
        },

        // ----- TECHNICAL ISSUES -----
        {
            id: "5050-location-blocked",
            keywords: ["location blocked", "can't access", "blocked", "not available in my area", "geolocation", "VPN", "location error", "location services"],
            question: "Customer is blocked due to location",
            response: `Hi there,

I'm sorry you're experiencing this issue. Our lottery is licensed by AGCO (Alcohol and Gaming Commission of Ontario) and can only sell tickets to people physically located within Ontario at the time of purchase.

If you're in Ontario but still seeing a location error, here are some things to try:
• Disable any VPN or proxy services you may be using
• Enable location services in your browser settings
• Try a different browser or device
• If on mobile, ensure GPS is enabled

If you're using satellite internet, please note that depending on the time of day, your connection may route through servers outside Ontario. Try again at a different time.

If you continue to have issues and you're certain you're in Ontario, please let me know and I can look into it further.

Best regards`
        },
        {
            id: "5050-eastlink",
            keywords: ["eastlink", "east link", "eastlink internet"],
            question: "EastLink Internet users experiencing location issues",
            response: `Hi there,

This issue is specific to EastLink internet customers, and unfortunately we're unable to resolve it on our end.

The issue is that EastLink's IP addresses sometimes register as being outside of Ontario, which triggers our geolocation block.

The solution is to contact EastLink directly and ask them to correct this issue. Their customer service line is 1-888-345-1111.

Alternatively, you can try purchasing tickets using a different internet connection (such as mobile data) or from a different device.

Thank you for your patience!

Best regards`
        },
        {
            id: "5050-outside-ontario",
            keywords: ["outside ontario", "other province", "united states", "not in ontario", "different province", "another country"],
            question: "Customer asking if they can buy from outside Ontario",
            response: `Hi there,

Thank you for reaching out!

Unfortunately, our lottery is licensed by the Alcohol and Gaming Commission of Ontario (AGCO), which means only people physically located inside Ontario at the time of purchase are able to participate.

It is not our intention to exclude anyone from supporting our cause, however we are bound by the laws and regulations of the province of Ontario.

Please let me know if you have any further questions!

Best regards`
        },
        {
            id: "5050-website-not-working",
            keywords: ["website not working", "site down", "error message", "page not loading", "website problem", "can't access website", "trouble purchasing"],
            question: "Customer is having website issues",
            response: `Hi there,

I'm sorry to hear you're having trouble with the website. Let me help troubleshoot.

Please try the following:
• Clear your browser's cache and cookies
• Try a different browser (Chrome, Firefox, Safari, Edge)
• Disable any ad blockers or browser extensions temporarily
• Make sure location services are enabled for your browser
• Try accessing the site from a different device

If you're still having issues, could you please let me know:
• What browser you're using
• What error message (if any) you're seeing
• What you were trying to do when the problem occurred

This will help me investigate and get you back on track!

Best regards`
        },
        {
            id: "5050-mobile-app",
            keywords: ["mobile app", "app download", "phone app", "is there an app", "android app", "iphone app"],
            question: "Customer asking about mobile app",
            response: `Hi there,

We don't currently have a dedicated mobile app, but our website at [WEBSITE] is fully mobile-responsive and works great on smartphones and tablets!

Simply visit the website in your phone's browser to:
• Purchase tickets
• Check draw results
• Manage your subscription

You can also add the website to your home screen for quick access - it will work just like an app!

Let me know if you have any other questions.

Best regards`
        },

        // ----- GROUPS -----
        {
            id: "5050-group-tickets",
            keywords: ["add group", "group members", "add names", "change group", "group ticket"],
            question: "Customer wants to add group members",
            response: `Hi there,

Thank you for reaching out!

Unfortunately, we are unable to add names or change group details once the tickets have been purchased.

However, you can simply forward the ticket confirmation email to your group members directly so they'll have a copy of the ticket numbers in case you win.

We appreciate your support and good luck with the draws!

Best regards`
        },
        {
            id: "5050-gift-tickets",
            keywords: ["gift", "buy for someone", "purchase as gift", "gift tickets", "for someone else"],
            question: "Customer wants to gift tickets to someone",
            response: `Hi there,

What a thoughtful gift idea!

You can purchase tickets on behalf of someone else. When buying, you would:
1. Create an account using YOUR information (as the purchaser)
2. Complete the purchase
3. Forward the ticket confirmation email to your gift recipient

Alternatively, if the recipient already has an account, you could send them funds to buy their own tickets.

Important note: Any prize would be awarded to whoever's account the tickets are registered under, so make sure the intended recipient's information is used if you want them to claim any winnings directly.

Let me know if you have any other questions!

Best regards`
        },

        // ----- GENERAL QUESTIONS -----
        {
            id: "5050-tax-receipt",
            keywords: ["tax receipt", "charitable receipt", "donation receipt", "tax deduction", "tax purposes"],
            question: "Customer asking for a tax receipt",
            response: `Hi there,

Thank you for your support of [ORGANIZATION]!

Unfortunately, we're not able to issue tax receipts for lottery ticket purchases. Under Canadian tax law, lottery tickets are not considered charitable donations, even when the proceeds support a charitable cause.

The purchase is considered a gaming transaction rather than a donation, which is why tax receipts cannot be provided.

If you're interested in making a tax-deductible donation to [ORGANIZATION], I'd be happy to provide information on how to do that separately.

Thank you for understanding!

Best regards`
        },
        {
            id: "5050-how-funds-used",
            keywords: ["where does money go", "how are funds used", "what does it support", "how does it help", "proceeds go to", "hospital", "impact"],
            question: "Customer wants to know how lottery proceeds are used",
            response: `Hi there,

Thank you for asking - it's wonderful to know you care about where your support goes!

Proceeds from our lottery directly support [ORGANIZATION] and its mission. Lottery funds help provide vital equipment, programs, and services that make a real difference in our community.

Every ticket purchased helps us continue this important work. We're so grateful for supporters like you who make it possible.

If you'd like more specific information about current initiatives or how funds are allocated, I'd be happy to connect you with our foundation team.

Thank you for your support!

Best regards`
        },
        {
            id: "5050-who-can-play",
            keywords: ["who can play", "eligibility", "age requirement", "can I play", "requirements to play"],
            question: "Customer asking about eligibility to play",
            response: `Hi there,

Great question! To purchase tickets, you must:

• Be 18 years of age or older
• Be physically located in Ontario at the time of purchase
• Not be an employee or immediate family member of [ORGANIZATION] or the lottery operator

These rules are set by AGCO (Alcohol and Gaming Commission of Ontario) to ensure fair and responsible gaming.

If you meet these requirements, you're welcome to play! Visit [WEBSITE] to get your tickets.

Best regards`
        },
        {
            id: "5050-is-it-legit",
            keywords: ["scam", "is this real", "legitimate", "fake", "fraud", "rigged", "fixed"],
            question: "Customer questioning if lottery is legitimate",
            response: `Hi there,

Great question - it's smart to be cautious!

Our lottery is 100% legitimate. It's licensed and regulated by the Alcohol & Gaming Commission of Ontario (AGCO). All draws are conducted using AGCO-approved systems, and we operate under strict regulatory oversight.

Lottery proceeds support [ORGANIZATION] and have helped fund vital equipment and programs for our community.

You can learn more about our lottery and see our winners at [WEBSITE].

If you have any other concerns, please don't hesitate to reach out!

Best regards`
        },

        // ----- ESCALATION / FALLBACK -----
        {
            id: "5050-escalate-to-manager",
            keywords: ["unclear", "confusing", "doesn't make sense", "strange", "weird", "angry", "upset", "furious", "threatening", "lawyer", "sue", "legal action", "complaint", "unacceptable"],
            question: "Question is unclear, bizarre, confrontational, or cannot be answered",
            response: `Hi there,

Thank you for reaching out.

I want to make sure your concern is addressed properly, so I'm going to pass your email along to my manager who will be able to look into this further and get back to you.

Thank you for your patience!

Best regards`
        }
    ],

    // ==================== CATCH THE ACE / PROGRESSIVE JACKPOT KNOWLEDGE ====================
    "cta": [
        // ----- HOW IT WORKS -----
        {
            id: "cta-how-it-works",
            keywords: ["how does it work", "explain", "how to play", "rules", "what is catch the ace", "progressive"],
            question: "Customer wants to understand how Catch the Ace works",
            response: `Hi there,

Great question! Catch the Ace is an exciting progressive jackpot lottery. Here's how it works:

The Basics:
• A deck of 52 playing cards is sealed at the start
• Each week, we draw a winning ticket number
• That winner gets to select and reveal one card from the deck
• If they reveal the Ace of Spades, they win the PROGRESSIVE JACKPOT!
• If not, they still win the weekly prize, and the jackpot grows

The Jackpot:
• The progressive jackpot builds each week until someone finds the Ace of Spades
• As cards are eliminated, your odds of winning the big jackpot improve!

Important:
• You must purchase new tickets each week to be entered - tickets don't carry over
• Each week is a new draw with a new weekly prize

Would you like any clarification on the rules?

Best regards`
        },
        {
            id: "cta-tickets-carry-over",
            keywords: ["carry over", "next week", "still valid", "use again", "tickets expire", "repurchase", "buy every week"],
            question: "Customer asking if tickets carry over to next week",
            response: `Hi there,

Great question! Unlike some lotteries, Catch the Ace tickets do NOT carry over from week to week.

Each weekly draw is separate, so you'll need to purchase new tickets each week to be entered into that week's draw.

This is why many of our players set up a weekly subscription - it ensures you never miss a chance at the growing jackpot! The subscription automatically purchases your chosen number of tickets before each draw.

Would you like help setting up a subscription?

Best regards`
        },
        {
            id: "cta-what-if-not-ace",
            keywords: ["not the ace", "wrong card", "didn't find ace", "picked wrong card", "weekly prize"],
            question: "Customer asking what happens if the Ace of Spades isn't found",
            response: `Hi there,

If the winning ticket holder picks a card and it's NOT the Ace of Spades, here's what happens:

1. They still win! They receive the weekly prize (typically a percentage of that week's ticket sales)
2. The revealed card is eliminated from the deck, improving everyone's odds for next week
3. The progressive jackpot keeps growing - a portion of each week's sales is added
4. The game continues next week with a new draw

As more cards are eliminated, the odds of finding the Ace of Spades get better and better - making the game even more exciting as it progresses!

Best regards`
        },
        {
            id: "cta-cards-remaining",
            keywords: ["cards left", "remaining cards", "how many cards", "cards eliminated", "which cards left"],
            question: "Customer asking about remaining cards in the deck",
            response: `Hi there,

You can see exactly which cards remain in the deck on our website at [WEBSITE].

We display:
• Which cards have been revealed (eliminated)
• How many cards are left in the deck
• The improving odds of finding the Ace of Spades

As more cards are eliminated each week, your chances of hitting the big jackpot increase!

Best regards`
        },
        {
            id: "cta-select-card",
            keywords: ["select card", "pick card", "choose card", "which card", "card selection"],
            question: "Customer asking about how card selection works",
            response: `Hi there,

Great question! When you purchase your tickets, each ticket is assigned a card selection number. Here's how it works:

• Each ticket has a randomly assigned card position (1-52)
• If your ticket is drawn as the winner, that card number determines which card you reveal

The exact process is explained on your ticket confirmation, but rest assured - if you win the weekly draw, we'll guide you through the card selection process!

Good luck!

Best regards`
        },
        {
            id: "cta-when-does-it-end",
            keywords: ["when does it end", "how long", "end date", "game over", "final draw"],
            question: "Customer asking when the game ends",
            response: `Hi there,

Catch the Ace continues until someone finds the Ace of Spades! There's no set end date.

Each week:
• A new ticket is drawn
• That winner reveals a card
• If it's the Ace of Spades, they win the progressive jackpot and the game resets
• If not, the game continues and the jackpot grows

As more cards are eliminated, the excitement builds - and eventually, someone will find that Ace!

Don't miss your chance to be part of it. Get your tickets at [WEBSITE].

Best regards`
        },

        // ----- TICKETS -----
        {
            id: "cta-tickets-not-received",
            keywords: ["didn't receive", "no tickets", "didn't get", "haven't received", "where are my tickets"],
            question: "Customer didn't receive their ticket confirmation email",
            response: `Hi there,

Thank you for reaching out and for supporting [ORGANIZATION]!

I'm sorry your tickets haven't arrived. These emails can sometimes end up in spam or junk folders, so please check there first.

If you still can't find them, I can resend your ticket confirmation right away. Just confirm the email address you used when purchasing.

Rest assured, your tickets are safely in our system even if the email went astray.

Thank you for your patience!

Best regards`
        },
        {
            id: "cta-resend-tickets",
            keywords: ["resend", "send again", "forward", "forwarded", "send tickets again"],
            question: "Customer wants tickets resent",
            response: `Hi there,

Of course! I've forwarded your tickets to you. Please scroll down in the email to view all your ticket numbers.

If you don't receive them within the next 30 minutes, please check your spam/junk folder.

We appreciate your support and good luck!

Best regards`
        },

        // ----- SUBSCRIPTIONS -----
        {
            id: "cta-subscription",
            keywords: ["subscription", "weekly auto", "automatic weekly", "subscribe", "recurring"],
            question: "Customer wants to set up a weekly subscription",
            response: `Hi there,

Setting up a subscription is easy and ensures you never miss a draw!

Here's how to subscribe:
1. Visit [WEBSITE]
2. Select your ticket package
3. During checkout, select the subscription option
4. Your payment method will be charged automatically each week before the draw

You can manage or cancel your subscription anytime at [ACCOUNT_URL].

With a subscription, your tickets are purchased and emailed to you automatically each week - one less thing to remember!

Would you like any help getting set up?

Best regards`
        },
        {
            id: "cta-cancel-subscription",
            keywords: ["cancel subscription", "stop subscription", "unsubscribe", "stop weekly", "end subscription"],
            question: "Customer wants to cancel their subscription",
            response: `Hi there,

I can help you with that!

You can cancel your subscription by logging into your account at [ACCOUNT_URL] and navigating to subscription settings.

Or, if you'd prefer, I can cancel it for you. Just confirm the email address on your account.

Please note: Any tickets already purchased for this week's draw remain valid - the cancellation only stops future automatic purchases.

Let me know how you'd like to proceed!

Best regards`
        },
        {
            id: "cta-manage-subscription",
            keywords: ["manage subscription", "subscription settings", "change subscription"],
            question: "Customer wants to manage their subscription",
            response: `Hi there,

You can manage your subscription by visiting [WEBSITE] and clicking "Manage Subscriptions" at the top of the page.

You'll be prompted to log in, and once you're in, you can modify or cancel your subscription anytime!

Let me know if you need any help.

Best regards`
        },
        {
            id: "cta-unexpected-charge",
            keywords: ["didn't purchase", "charged without buying", "subscribed without knowing", "automatic charge", "didn't sign up"],
            question: "Customer charged unexpectedly",
            response: `Hi there,

Thank you for reaching out about this concern. I understand receiving an unexpected charge can be confusing.

After reviewing your account, it appears you may be signed up for a subscription. This means that each week, your payment method is automatically charged, and your ticket numbers are sent to you.

If you signed up for this accidentally, I can cancel it for you right away. Would you also like me to look into a refund for the most recent charge?

Please let me know how you'd like to proceed.

Best regards`
        },

        // ----- DRAWS & WINNING -----
        {
            id: "cta-when-is-draw",
            keywords: ["when is draw", "draw time", "what day", "when does draw happen", "draw date"],
            question: "Customer wants to know when the draw takes place",
            response: `Hi there,

Our weekly draw takes place every [DRAW_DAY] at [DRAW_TIME].

You can watch the draw live on our website or social media channels! The winning ticket number and revealed card are also posted on [WEBSITE] shortly after.

Remember, tickets must be purchased before the cutoff time to be eligible for that week's draw.

Good luck!

Best regards`
        },
        {
            id: "cta-check-if-won",
            keywords: ["did I win", "check if won", "am I winner", "winning ticket", "how to know", "check numbers"],
            question: "Customer wants to know how to check if they won",
            response: `Hi there,

Here's how to find out if you've won:

After each draw:
• The winning ticket number is posted on [WEBSITE]
• Compare it to the ticket numbers in your confirmation email

If you win:
• We will contact you directly by phone AND email
• You'll have the exciting opportunity to pick a card from the deck!
• We never ask for payment or banking details to claim prizes

The winning numbers are posted within minutes of the draw concluding. But don't worry - we call all our winners, so you don't need to check manually!

Good luck!

Best regards`
        },
        {
            id: "cta-current-jackpot",
            keywords: ["jackpot", "how much", "current jackpot", "prize amount", "progressive pot"],
            question: "Customer asking about the current jackpot",
            response: `Hi there,

The progressive jackpot grows each week until someone finds the Ace of Spades!

For the current jackpot amount, please visit [WEBSITE] - it's displayed prominently on the homepage and updates in real-time.

Remember, there's also a weekly prize for the ticket holder who gets to pick a card, even if they don't find the Ace of Spades. So there's something to win every week!

Good luck!

Best regards`
        },

        // ----- REFUNDS & PAYMENTS -----
        {
            id: "cta-refund",
            keywords: ["refund", "money back", "cancel purchase", "get refund", "want refund", "wrong package"],
            question: "Customer requesting a refund",
            response: `Hi there,

Thank you for reaching out about a refund.

As per AGCO regulations for charitable gaming, lottery ticket purchases are generally non-refundable once the transaction is complete and tickets have been issued.

However, I'd be happy to look into your specific situation. Could you please provide:
• Your account email address
• The date and amount of purchase
• The reason for your refund request

I'll do my best to help!

Best regards`
        },
        {
            id: "cta-payment-issue",
            keywords: ["payment failed", "card declined", "couldn't buy", "payment problem", "transaction failed"],
            question: "Customer having payment issues",
            response: `Hi there,

I'm sorry to hear your payment didn't go through. Here are some common causes and solutions:

Common issues:
• Card details entered incorrectly
• Insufficient funds
• Bank flagging the transaction (contact them to authorize)
• Expired card

Try these steps:
1. Double-check your card number, expiry date, and CVV
2. Ensure your billing address matches your bank's records
3. Contact your bank if the issue persists
4. Try a different payment method

If you're still having trouble after trying these steps, please let me know and I'll investigate further.

Best regards`
        },

        // ----- TECHNICAL & ACCOUNT -----
        {
            id: "cta-location-blocked",
            keywords: ["blocked", "location", "can't access", "not available", "geolocation", "location error", "location blocking"],
            question: "Customer is location blocked",
            response: `Hi there,

I'm sorry you're having trouble accessing our lottery. We're licensed by AGCO and can only sell tickets to customers physically located in Ontario.

If you're in Ontario but seeing a location error, please try:
• Disabling any VPN or proxy services
• Enabling location services in your browser
• Using a different browser or device
• If on mobile, ensure GPS is enabled

If you're using satellite internet, please note that your connection may sometimes route through servers outside Ontario. Try again at a different time.

If you continue to experience issues while in Ontario, let me know and I'll investigate further.

Best regards`
        },
        {
            id: "cta-eastlink",
            keywords: ["eastlink", "east link"],
            question: "EastLink Internet users experiencing location issues",
            response: `Hi there,

This issue is specific to EastLink internet customers, and unfortunately we're unable to resolve it on our end.

The issue is that EastLink's IP addresses sometimes register as being outside of Ontario.

The solution is to contact EastLink directly at 1-888-345-1111 and ask them to correct this issue.

Alternatively, you can try purchasing tickets using a different internet connection (such as mobile data).

Thank you for your patience!

Best regards`
        },
        {
            id: "cta-outside-ontario",
            keywords: ["outside ontario", "other province", "not in ontario", "different province"],
            question: "Customer asking about buying from outside Ontario",
            response: `Hi there,

Thank you for reaching out!

Unfortunately, our Catch the Ace lottery is licensed by the Alcohol and Gaming Commission of Ontario (AGCO), which means only people physically located inside Ontario are able to participate.

It is not our intention to exclude anyone from supporting our cause, however we are bound by the laws of the province of Ontario.

Please let me know if you have any further questions!

Best regards`
        },
        {
            id: "cta-cant-access-website",
            keywords: ["can't access", "website not working", "won't load", "error buying", "trouble purchasing", "website problem"],
            question: "Customer having trouble accessing the website",
            response: `Hi there,

Thank you for reaching out!

If you're unable to access the website, please try the following:
• Ensure your device's location services are enabled (you must be in Ontario)
• Clear your browser cache and cookies
• Try a different browser or device
• Make sure you've accepted all terms and conditions

Sometimes turning your location services off and on again, or switching from WiFi to mobile data can help.

If the problem persists, please let me know what device and browser you're using, and any error messages you're seeing, and I'll investigate further.

Best regards`
        },
        {
            id: "cta-login-issues",
            keywords: ["can't login", "forgot password", "reset password", "locked out", "login problem"],
            question: "Customer having login issues",
            response: `Hi there,

I'm sorry you're having trouble logging in. Let me help!

To reset your password:
1. Go to [ACCOUNT_URL]
2. Click "Forgot Password"
3. Enter your email address
4. Check your inbox for a reset link (check spam/junk too)
5. Click the link and create a new password

If you don't receive the email or continue to have issues, please let me know your account email address and I'll look into it.

Best regards`
        },
        {
            id: "cta-update-info",
            keywords: ["update account", "change email", "change phone", "update info", "change address"],
            question: "Customer wants to update account information",
            response: `Hi there,

You can update your account information by logging in at [ACCOUNT_URL].

Once logged in, navigate to your profile or account settings to update:
• Email address
• Phone number
• Mailing address
• Payment methods

If you can't access your account or need help making changes, just let me know what you'd like updated and I can assist.

Best regards`
        },
        {
            id: "cta-wrong-email",
            keywords: ["wrong email", "incorrect email", "typo email", "email mistake"],
            question: "Customer used wrong email address",
            response: `Hi there,

Thank you for reaching out!

I've corrected the email address on your account and resent your tickets to you. Please let me know if they don't arrive within the next 30 minutes - and be sure to check your junk/spam folder just in case.

Thank you for your support, and good luck!

Best regards`
        },

        // ----- GENERAL -----
        {
            id: "cta-who-can-play",
            keywords: ["who can play", "eligibility", "age", "requirements", "can I play"],
            question: "Customer asking about eligibility",
            response: `Hi there,

To participate in our Catch the Ace lottery, you must:

• Be 18 years of age or older
• Be physically located in Ontario at the time of purchase
• Not be an employee or immediate family member of [ORGANIZATION] or the lottery operator

These requirements are set by AGCO (Alcohol and Gaming Commission of Ontario) to ensure fair and responsible gaming.

If you meet these criteria, head to [WEBSITE] to get your tickets for this week's draw!

Best regards`
        },
        {
            id: "cta-tax-receipt",
            keywords: ["tax receipt", "donation receipt", "charitable receipt", "tax purposes"],
            question: "Customer asking for a tax receipt",
            response: `Hi there,

Thank you for your support of [ORGANIZATION]!

Unfortunately, we cannot issue tax receipts for lottery ticket purchases. Under Canadian tax law, lottery tickets are considered a gaming purchase rather than a charitable donation, even though the proceeds support our charitable work.

If you're interested in making a tax-deductible donation to [ORGANIZATION], I'd be happy to provide information on how to do that separately.

Thank you for understanding, and good luck in the draw!

Best regards`
        },
        {
            id: "cta-how-funds-used",
            keywords: ["where does money go", "how are funds used", "what does it support", "proceeds", "hospital", "impact"],
            question: "Customer asking how funds are used",
            response: `Hi there,

Thank you for asking - we love supporters who care about the impact of their contribution!

Proceeds from our Catch the Ace lottery directly support [ORGANIZATION] and its mission to serve our community.

Every ticket purchased helps fund essential programs, equipment, and services that make a real difference in people's lives.

If you'd like more specific information about current initiatives, I'd be happy to connect you with our foundation team.

Thank you for your support!

Best regards`
        },
        {
            id: "cta-gift-tickets",
            keywords: ["gift", "buy for someone", "for someone else", "gift tickets", "present"],
            question: "Customer wants to gift tickets",
            response: `Hi there,

What a great gift idea - the chance to win a jackpot!

You can purchase tickets on behalf of someone else. When you buy:
1. Use YOUR information to create the account and purchase
2. Forward the ticket confirmation email to your gift recipient

Important: Any prize would be awarded to whoever's account the tickets are registered under. If you want the recipient to claim winnings directly, they should create their own account.

Let me know if you have any other questions!

Best regards`
        },
        {
            id: "cta-is-it-legit",
            keywords: ["scam", "is this real", "legitimate", "fake", "fraud", "rigged"],
            question: "Customer questioning if lottery is legitimate",
            response: `Hi there,

Great question - it's always smart to be careful!

Our Catch the Ace lottery is 100% legitimate. It's licensed and regulated by the Alcohol & Gaming Commission of Ontario (AGCO). All draws are conducted using AGCO-approved systems under strict regulatory oversight.

Lottery proceeds directly support [ORGANIZATION] and have helped fund vital equipment and programs for our community.

You can learn more and see our winners at [WEBSITE].

If you have any other questions, please don't hesitate to ask!

Best regards`
        },

        // ----- ESCALATION / FALLBACK -----
        {
            id: "cta-escalate-to-manager",
            keywords: ["unclear", "confusing", "doesn't make sense", "strange", "weird", "angry", "upset", "furious", "threatening", "lawyer", "sue", "legal action", "complaint", "unacceptable"],
            question: "Question is unclear, bizarre, confrontational, or cannot be answered",
            response: `Hi there,

Thank you for reaching out.

I want to make sure your concern is addressed properly, so I'm going to pass your email along to my manager who will be able to look into this further and get back to you.

Thank you for your patience!

Best regards`
        }
    ]
};

// Function to search knowledge base
function searchKnowledgeBase(query, lottery = "both") {
    const queryLower = query.toLowerCase();
    const results = [];

    const searchIn = lottery === "both"
        ? [...KNOWLEDGE_BASE["5050"], ...KNOWLEDGE_BASE["cta"]]
        : KNOWLEDGE_BASE[lottery] || [];

    for (const item of searchIn) {
        let score = 0;

        // Check keywords
        for (const keyword of item.keywords) {
            if (queryLower.includes(keyword.toLowerCase())) {
                score += 10;
            }
        }

        // Check question text
        const questionWords = item.question.toLowerCase().split(/\s+/);
        const queryWords = queryLower.split(/\s+/);

        for (const qWord of queryWords) {
            if (qWord.length > 3) {
                for (const word of questionWords) {
                    if (word.includes(qWord) || qWord.includes(word)) {
                        score += 2;
                    }
                }
            }
        }

        if (score > 0) {
            results.push({ ...item, score });
        }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, 3); // Return top 3 matches
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KNOWLEDGE_BASE, searchKnowledgeBase };
}
