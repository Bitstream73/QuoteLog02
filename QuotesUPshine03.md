Complete the following items. Test them. If they fail, fix them:


To quotes: Add a twirl down option for any articles that have 3 or more quotes. When untwirled, show the first two quotes with subsequent article content fading to white underneath like this:

|twirl carrot| |Primary Article's Title| - |Publishing date in mm,dd,yyyy format|
|Head|  |QuoteAuthorA Quote01|   
|Shot|  
        |QuoteAuthorA Quote02| - - |Quote Author|
        |Share options|

|Head|  |QuoteAuthorB Quote 01| - |Quote Author|
----------------------------------------------------  
        |Primary News Source (When clicked, opens the primary article in a new tab)| |addl. News Sources|
        |a twirl down context around the quotes, or article summary| 

        |Share options|    

To Quotes: Use Non-seriffed font for article title.

Quotes Category tabs: Let's have broader categories: All, Politicians, Professionals, and Other [this would be all articles minus, Politicians and professionals categories]


When a category tab is selected, there are filter options derived from keywords, context and author descriptions, to further refine the displayed articles in the category. examples:

Under Politicians: U.S., UK, EU, Republican, Democrat, Labor, Candidate
Under Professionals: Law, STEM, philosophy, author, historian
Under Other: derive this from context and any provided keywords/categories from the metadata included in the RSS entry for the article.


Admin area: Add the ability to change the items for a Quote Author: Author's name, authors description, author categories, etc.
Admin Area: Add search option to quote management

To app: Changing Fetch settings and Disambiuation settings don't persist between new deployments. This needs to be hardened so they persist and are never lost in the same way as quotes entries in the database.


Multiple quotes from the same author that occur in sequence with each other should be ganged up with a single instance of the Author's name and title like this:


|Primary Article's Title| - |Publishing date in mm,dd,yyyy format|
|Head|  |QuoteAuthorA Quote01|   
|Shot|  |QuoteAuthorA Quote02| - - |Quote Author|
        |Share options|

|Head|  |QuoteAuthorB Quote 01| - |Quote Author|
|Shot|  
        |Share options|

|Head|  |QuoteAuthorA Quote03| - |Quote Author|
|Shot|
        |Share options|

        |Primary News Source (When clicked, opens the primary article in a new tab)| |addl. News Sources|
        |a twirl down context around the quotes, or article summary| 

        |Share options|    

Quote Authors should be assigned a category: Politician, Entertainer, Pundit, Athlete, and similar categories. (Suggest ones that are in common use and would be expected categories for quotes). Each category should have its own tab at the top of the page. The Politician tab should be the default open tab.

For political quote authors, reference their party officialation and office at the time of the quote
For athletes, reference their team and sport at the time of the quote
Do similar references for the other categories you suggest.

To Admin Page: To Quote entries, Add all the missing elements that are shown to users: Article title, context, date, etc.

To Admin Page: Add edit ability to quote text. Add ability to change headshot associated with a quote author

Remove "Latest Quote" headinng and "Noteworthy quotes extracted from today's news" subheading

Remove the date from header.

Under "Quote Log" heading in the header add a subhead that says "What, When, & Why They Said It."

Remove the "Login" item from the header.

Add the articles RSS metadata as json field in each quote record. We want to hold onto this in for search and in case that data proves useful in the future. 

Add a search bar to the header that allows searching for quotes, quote authors, categories, etc.