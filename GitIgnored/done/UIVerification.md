Put the files that result from this prompt in a folder in the root called "SiteTopicFocusChanges." Do not edit the root/Claude.md file in the root or the root/Prompt.md file. If you generate those files with those names as part of this prompt, put them in the "SiteTopicFocusChanges" folder

** Setup and testing **

Overall goal:

Using Puppeteer, visually verify that the changes below are implemented and working at https://whattheysaid.news/. If they aren't, fix the issues. Use your Frontend-designer skill for any changes you make to the UI based on the requirements below.

** Features to Confirm are visible and working correctly **

- Remove the UI for the reddit-style upvote downvote system

- "Trending Topics" should be the default open tab on the website's homepage.

- Clicking the "Important?" button for an item (quote, source, etc) should increment or decriment ImportantsCount by 1, depending on it's state. If it's already Pressed, then pressing it again -=1 ImportantsCount. If it's not pressed, then pressing it +=1 ImportantsCount. When pressed, the button turns green.

** Quote Blocks EVERYWHERE in the non-logged in version of the app should be formatted like this: **

┌──────────────────────────────────────┐
│ "Quote text spans full width..."    
|
| [Quote context]                                     
│ [ IMPORTANT? ]  [ Quote Datetime ]  [Quote ViewCount]                 
│ (Circular  Author Name  [badges]                  
│ Portrait)  Author description                     
│ [Source Url with linktext "Source"] [Topic 1] [Topic 2] <-- Top two topics maxmimum                                  
│ [Quote Share buttons]  [Share count ] <--if share count > 0        
└──────────────────────────────────────┘

Clicking on the actual quote, the author name, description, or the author portrait takes you to the author's page
Clicking the Source Url or Quote Context takes you to the Source page for the quote.
There should be minimal space between the Circular Portrait and the Author Name and Author Description.

Trending tabs are populated in order from highest to lowest of "ImportantsCount" + "Sharecount". Items with less than 1 "Important" field count are not displayed in Trending tabs.

** Items on the Trending Topics tab should be formatted like this: **

[TOPIC NAME IN HEADING FONT]
[Topic context]

["Sort by " ["Date" <-- this is the default] ["Importance" <-- Sorted High to low according to the sum of a quote's ImportantsCount + ShareCount + ViewCount
[ Quote Block 1]

[ Quote Block 2]

[ Quote Block 3]

[ See More ] <--takes you to the corresponding Topic page
[ IMPORTANT? ] <-- +=1's the important count for the Topic.
[Topic Share buttons] 


** Items in Trending Sources tab should be formatted like this: **

[SOURCE TITLE IN HEADING FONT]
[Source context]

["Sort by " ["Date" <-- this is the default] ["Importance" <-- Sorted High to low according to the sum of a quote's ImportantsCount + ShareCount + ViewCount
[ Quote Block 1]

[ Quote Block 2]

[ Quote Block 3]

[ See More ] <--takes you to the corresponding Source page
[ IMPORTANT? ] <-- +=1's the important count for the Source.
[Source Share buttons] 


** Items in All tab should be formatted the same way as Trending Sources: **

[SOURCE TITLE IN HEADING FONT]
[Source context]

["Sort by " ["Date" <-- this is the default] ["Importance" <-- Sorted High to low according to the sum of a quote's ImportantsCount + ShareCount + ViewCount
[ Quote Block 1]

[ Quote Block 2]

[ Quote Block 3]

[ See More ] <--takes you to the corresponding Source page
[ IMPORTANT? ] <-- +=1's the important count for the Source.
[Source Share buttons] 




** Items in the Trending Quotes tab should look like this: **

["Quote of the Day" heading]
[ Quote Block for quote with highest ImportantsCount for the Day]

["Quote of the Week" heading]
[ Quote Block for quote with highest ImportantsCount for the Week]

["Quote of the Month" heading]
[ Quote Block for quote with highest ImportantsCount for the Day]

["*Trending quotes change over time as views and shares change" small italic type]

["Recent Quotes" heading] 

["Sort by " ["Date" <-- this is the default] ["Importance" <-- Sorted High to low according to the sum of a quote's ImportantsCount + ShareCount + ViewCount
[ Quote Block 1] <-- quotes sorted from newest to oldest.

[ Quote Block 2]

[ Quote Block 3]
.
.
.
.


