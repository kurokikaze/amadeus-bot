module.exports = {
    "extends": "airbnb-base",
    "overrides": [
        {
            "files": ["*.js"],
            "rules": {
                "indent": ["error", 4],
                "no-restricted-syntax": "off",
                "no-console": "off",
                "max-classes-per-file": "off",
            }
        }
    ]
};