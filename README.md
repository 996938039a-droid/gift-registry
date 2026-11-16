# Wedding Gift Registry: Google Sheet + Apps Script version

The backend is a Google Apps Script that lives inside your Google Sheet. The Sheet is the database. The website is plain static files you host on Netlify (code on GitHub). There is no server to run, no service account and no API key.

```
Guest or couple's browser  ->  Netlify (static pages)
        |
        +--- one POST per action ---> Apps Script web app (Code.gs) ---> your Google Sheet
```

## What it does

**Couple:** create the registry, add gifts from any store (link and price) or cash goals, mark a gift as a group gift, share a WhatsApp link, confirm money received, see who bought what, on behalf of which group, with what card message, and the wrap-order status. Optional "keep it a surprise" setting.

**Guest:** sign in, see the registry, buy a gift themselves (reserve, buy at the store, mark bought), or order the gift-wrap service (paper, ribbon, card message, ship to your wrapping point, pay the fee, track status until "Ready at the venue"). A guest can buy on behalf of a named group, start a group gift (they organise, friends pay their UPI), pitch in on group gifts and cash goals, and leave a message.

**Accounts:** sign up, sign in, and forgot password by emailed 6-digit code.

**Money rule:** the system never holds money. Guests pay stores at checkout or pay UPI IDs from their own UPI app. The wrap fee goes to your business UPI and you mark it paid in the Sheet.

## Setup (about 25 minutes)

### 1. Open the Sheet
The Sheet "Gift Registry Database" is already created in your Google Drive with the tabs `Config, Users, Registries, Items, Claims, Pledges, Messages`. (If you start from a blank Sheet instead, step 3 builds the tabs for you.)

### 2. Add the code
1. In the Sheet: **Extensions > Apps Script**.
2. Delete the sample `myFunction` code. Paste the whole of `apps-script/Code.gs`. Click **Save** (disk icon).

### 3. Run setup once
1. In the function dropdown at the top choose **setup**, click **Run**.
2. Google asks for permission. Click Review permissions, choose your account. You will see "Google hasn't verified this app". This is your own script, so click **Advanced > Go to (project name) (unsafe) > Allow**. It needs your Sheet (read and write) and the ability to send email (for password resets).
3. Open **Execution log**. You should see "Setup finished". Setup links the script to this Sheet, creates two random secrets, and makes any missing tabs.

### 4. Run the self-test
Choose **selfTest** and Run. Every line in the log should say PASS. It checks the things only Google can confirm: that text like `=1+1` is stored as plain text, that sessions and password hashing work, and how long one password hash takes (if it is above about 300 ms, lower `HASH_ROUNDS` at the top of `Code.gs`).

### 5. Fill in your settings
In the **Config** tab (yellow cells): `serviceUpi` (your business UPI ID), `wrapPoint` (address guests ship gifts to). You can also change the service name and the two fees. They apply immediately.

### 6. Deploy as a web app
1. **Deploy > New deployment**. Click the gear next to "Select type", choose **Web app**.
2. **Execute as: Me. Who has access: Anyone.** Click Deploy.
3. Copy the **Web app URL** (it ends in `/exec`).

"Anyone" only means anyone can reach the address. Nothing is returned without signing in.

### 7. Connect the website
1. Open `public/config.js` and paste the URL between the quotes.
2. Put the folder on GitHub, then in Netlify: Add new site > Import from GitHub. No build command, publish directory `public` (already set in `netlify.toml`). You can also drag the `public` folder onto Netlify.
3. Open your Netlify address, sign up as a couple, create a registry.

### Changing the code later
Edit `Code.gs` in the Apps Script editor, then **Deploy > Manage deployments > pencil icon > Version: New version > Deploy**. The URL stays the same. Saving alone does not update the live web app.

## Running the gift-wrap service from the Sheet

Open the **Claims** tab. Each guest purchase is one row. Rows with `delivery = service` are wrap orders. Edit only these two columns, which have dropdowns:

| Column | Values | Meaning |
|---|---|---|
| `feeStatus` | unpaid, claimed, paid | the guest says they paid (`claimed`); set `paid` after checking your UPI |
| `wrapStatus` | awaiting, received, wrapped, atvenue, handed | what the couple and guest see |

Guests quote a short reference on the parcel: the first 6 characters of the row `id` in capitals. Use a Sheet filter on `delivery`. Do not sort the data tabs, delete rows in the middle, or edit `id` columns while the site is live.

## Try it on your computer first (no Google needed)
```
npm run dev      # http://localhost:8888, data in .data/db.json
npm test         # 16 backend tests
```
`scripts/mock-gas.js` stands in for Google's services and runs `Code.gs` unchanged. The preview shows password-reset emails at `/__mail`.

## Things to know

- **Who can see the data:** anyone with edit access to the Sheet can open the Apps Script editor and read its secrets, and can read the Users tab (emails and password hashes). Share the Sheet only with people you trust to run the service.
- **Passwords:** stored as salted, iterated HMAC-SHA256 hashes using a secret ("pepper") kept in Script Properties, not in the Sheet. A copy of the Users tab alone does not let anyone guess passwords offline. This is weaker than a dedicated password algorithm such as bcrypt, which Apps Script does not offer.
- **Sessions:** a signed token saved in the browser (14 days). Run `setup()` after deleting the `JWT_SECRET` property to sign everyone out.
- **Sign-in protection:** 8 wrong passwords lock that email for 15 minutes. Reset codes expire in 15 minutes and allow 5 tries.
- **Two people at once:** every write waits for a script lock, so two guests cannot take the same gift.
- **Limits (Google's, may change):** consumer Gmail accounts can send about 100 emails a day, so only password resets use email. Apps Script allows 30 simultaneous executions per user and 6 minutes per execution. Each call goes through Google's script service, so pages feel slower than on a normal server, especially after a quiet period.
- **Privacy:** the Sheet holds names, emails, messages. Indian data protection rules (DPDP) will apply at scale; get advice before collecting widely.
- **If the site says it cannot reach the server:** check the URL ends in `/exec`, access is set to Anyone, and you redeployed a new version after editing the code.

## Files
`apps-script/Code.gs` the whole backend (paste into the Sheet) · `public/` the website · `public/config.js` where the web app URL goes · `scripts/mock-gas.js` and `scripts/dev-server.js` local preview · `test/` automated tests · `netlify.toml` static hosting settings
