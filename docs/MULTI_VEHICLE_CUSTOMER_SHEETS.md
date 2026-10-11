# Customer vehicle sheets

Open **Saved** from Inventory to return to an employee-owned named list. Select a list to continue working with it; the selected list is remembered on this browser for the same employee, role and store. List membership and names are retained by the authenticated central service, so the list can be reopened later on another signed-in device.

Use **Add vehicles** to search current authorized inventory, add vehicles to the selected list, or remove vehicles from the list. **Manage** changes the name or deletes the list. Use initials or a nickname; keep customer contact details in the CRM.

Choose **Customer sheet** to refresh the saved membership and the app's latest published vehicle data before building the document. The Format control offers:

- **Detailed vehicle sheets:** the existing portrait sheets, with complete customer-facing content and one vehicle starting on each page.
- **Vehicle comparison:** a landscape Letter comparison with larger photos, selling price, mileage, stock, certification, grouped specifications and four complete standout features per vehicle. Ordinary groups of two or three share a page; four are balanced two plus two, and seven three plus two plus two. Multi-vehicle comparisons use a modestly shorter photo row when needed to keep a full comparison together; text sizes and facts are preserved. Longer names, specifications or packages retain their full text and may need fewer columns or continuation pages.

Within a saved-list preview, **Edit list** returns to list editing and **Refresh comparison** rebuilds the document with current membership and the latest successfully checked inventory. A failed refresh is reported rather than presenting the previous document as newly refreshed. Vehicles missing from current authorized inventory remain saved but are excluded from the customer document.

These checks read the app's published data; they do not fetch live OEM reports or guarantee physical availability. Previously shared PDFs are snapshots and do not update themselves. After editing or refreshing, use **Share** or **Save PDF** again to distribute a new copy. Nothing is sent automatically.

**Save PDF** downloads the actual PDF. **Share** shares that PDF when file sharing is supported; otherwise it saves the PDF to share yourself. **Print / Save as PDF** uses the selected format and paper orientation. Switching back to detailed sheets restores portrait printing.

Each published HTTPS listing has a locally generated QR code with a four-module quiet zone. Customers can scan the printed code for the listing and its photos; the same QR remains clickable in the digital document. Missing or unsafe listing targets show a dealership follow-up caption instead. No URL is sent to a third-party QR service. The comparison excludes employee/customer labels, MSRP reference values, holds, operational notes and report timestamps.

## Verification boundary

Validation uses deterministic synthetic vehicles, not production inventory. The app and companion were inspected at 390×844, 1024×768, 1320×820 and 1440×900. Three representative vehicles exported and browser-printed to a single 792×612-point page in both surfaces. All three listing QR codes decoded from the actual exported PDF rasterized at 150 DPI. Physical iPhone/printer checks and live listing verification are separate; synthetic sample links are demonstration targets.
