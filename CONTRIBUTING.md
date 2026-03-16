# Contributing to spectralQ Core Edition

Thank you for your interest in contributing. This document provides guidelines for contributing to the project.

## Reporting Bugs

Open a GitHub issue with:

- A clear, descriptive title
- Steps to reproduce the problem
- Expected vs. actual behavior
- Your environment (OS, Python version, browser)
- Relevant log output or screenshots

## Suggesting Features

Open a GitHub issue with the "enhancement" label. Describe:

- The problem your feature would solve
- Your proposed solution
- Any alternatives you considered

## Creating Plugins

Plugins are the preferred way to extend spectralQ. See the [Plugin Architecture](README.md#plugin-architecture) section in the README.

To create a new Watch Zone plugin:

```
plugins/watchzone/your_plugin/
  __init__.py           # Your plugin class extending BasePlugin
  i18n.json             # Translations for de, en, fr, es
  templates/_panel.html # Dashboard panel
  static/               # Optional JS/CSS
```

To create a new Analysis plugin:

```
plugins/analysis/your_plugin/
  __init__.py            # Your plugin class
  i18n.json              # Translations
  templates/_modal.html  # Analysis modal
```

Key rules:

- Set `plugin_type` and `plugin_id` in your class
- Provide translations for all four languages (de/en/fr/es)
- Declare `required_credentials` in your `meta` dict
- Keep plugins self-contained; do not modify core files

## Code Style

**Python:**

- Follow PEP 8
- Use type hints where practical
- Keep functions focused and under 50 lines where possible
- Use docstrings for public functions and classes

**JavaScript:**

- Use `const`/`let`, no `var`
- Prefer vanilla JS over frameworks in plugin code
- Keep plugin JS in the plugin's own `static/` directory

**Templates:**

- Use Jinja2 template inheritance from the base templates
- Prefix plugin template files with `_` (e.g., `_panel.html`)

## Pull Request Process

1. Fork the repository and create a feature branch from `main`
2. Make your changes in focused, atomic commits
3. Ensure the application starts and your changes work correctly
4. Update i18n files if you added user-facing strings
5. Open a pull request against `main` with a clear description
6. Address any review feedback

For plugin contributions, include a brief description of the data source or analysis method and any required API keys.

## Questions

If you have questions, open a discussion on GitHub or reach out via [broschart.net](https://broschart.net).
