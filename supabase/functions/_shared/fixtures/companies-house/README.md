# Companies House fixtures

Hand-written on 21 September 2026 in the shapes the Companies House REST
API documents (developer-specs.company-information.service.gov.uk). No
`COMPANIES_HOUSE_API_KEY` was available in the build session, so none of
these is a saved real response; the company is invented. When a key is to
hand, replace each file with the real answer for a small software company
(`curl -u "$COMPANIES_HOUSE_API_KEY:" https://api.company-information.service.gov.uk/company/<number>`)
and keep the same file names.

- `search.json`: GET /search/companies?q=fable+labs&items_per_page=10
- `profile.json`: GET /company/12345678
- `officers.json`: GET /company/12345678/officers?items_per_page=50
- `filing-history-capital.json`: GET /company/12345678/filing-history?category=capital&items_per_page=50

advanced-search.json: a hand-written page of GET /advanced-search/companies
(company_status=active, sic_codes=62012, location=London) in the published
shape: `hits` is the register's total, the items carry `company_name` (not
`title`), `date_of_creation`, `registered_office_address` and `sic_codes`. The
third item has no number and the fourth is dissolved, to test the parser.
