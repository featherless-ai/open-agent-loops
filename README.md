# Open Agent OS

A minimal, provider-agnostic **agentic loop**. The whole point of this package
is to make the components of the agent **plug-and-play, independently testable, and reliable** — every fundamental thing sits behind an interface, so it can be
swapped without touching the loop.

## Documentation

The full documentation is a [fumadocs](https://fumadocs.dev) site under
[`docs-fuma/`](./docs-fuma). To run it locally:

```sh
cd docs-fuma
bun install        # first time only
bun run dev
```

Then open <http://localhost:3000/docs>. (From the repo root, `bun run docs:site`
does the same.)
