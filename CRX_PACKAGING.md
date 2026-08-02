# Chrome extension release packaging

The extension uses Chrome's self-hosted update mechanism. Before the first release, replace the placeholders in `chrome-extension/update_manifest.xml` with the GitHub owner, repository, release URL, CRX extension ID, and release version. Set the same update URL in the extension manifest's `update_url` field.

Generate a private key once outside this repository and keep it in a password-protected secret store. Never commit it, copy it to `release/`, or include it in an archive:

`chrome --pack-extension=chrome-extension`

Keep the resulting `.pem` outside the project, then package every later version with:

`$env:HELPY_CRX_KEY='C:\secure\helpy-extension.pem'; npm.cmd run package:crx`

Upload the generated CRX and `update_manifest.xml` to the GitHub Release. Bump both the extension manifest version and update manifest version for each release. Chrome only permits self-hosted CRX updates for installations deployed through supported enterprise or policy-managed channels; ordinary consumer Chrome installs generally require the Chrome Web Store.
