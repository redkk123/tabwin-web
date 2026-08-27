# Federal/institutional UI profile

**Status:** research baseline, not yet a binding design decision.

If the project is formally adopted or deployed in Brazil's federal public administration, the UI should be evaluated against the current Padrão Digital de Governo / Design System rather than inventing an unrelated government visual language.

As checked on 2026-08-26:

- the official Design System site reports version 3.7.0 and provides Web Components intended to work across frameworks such as React, Angular and Vue;
- the official material describes the Design System as the interface standard for consistent federal digital experiences;
- official materials state CC0/MIT licensing for the Design System assets;
- government accessibility guidance continues to expose eMAG material and accessibility tooling, while WCAG remains the international baseline to test against.

## Project decision for now

Do **not** tightly couple the semantic engine to any UI library.

For the web application:

- build accessible semantic components first;
- keep visual tokens/theme replaceable;
- later implement an `institutional-govbr` theme/profile if adoption context requires it;
- avoid implying official government status merely by using gov.br visual patterns.

## References

- https://www.gov.br/ds
- https://www.gov.br/governodigital/pt-br/estrategias-e-governanca-digital/sisp/guia-do-gestor/guia-orientativo-de-padroes-e-fluxos-das-tecnologias-de-transformacao-digital/padrao-de-governo-digital-design-system
- https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/acessibilidade-digital/modelo-de-acessibilidade
