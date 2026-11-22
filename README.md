[![make.fun](https://make.fun/badge/the-picture-that-tastes-of-one-20261122-2047.svg)](https://make.fun/bounty/the-picture-that-tastes-of-one-20261122-2047)
[![rank](https://make.fun/badge/the-picture-that-tastes-of-one-20261122-2047/funtoons/the-picture-that-tastes-of-one-20261122-2047-bot-v1/rank.svg)](https://make.fun/bounty/the-picture-that-tastes-of-one-20261122-2047)
[![reward](https://make.fun/badge/the-picture-that-tastes-of-one-20261122-2047/funtoons/the-picture-that-tastes-of-one-20261122-2047-bot-v1/reward.svg)](https://make.fun/bounty/the-picture-that-tastes-of-one-20261122-2047)

# The picture that tastes of one ingredient — Honey

An entry for the [make.fun bounty "The picture that tastes of one ingredient"](https://make.fun/bounty/the-picture-that-tastes-of-one-20261122-2047).

`main.ts` paints one picture of food — a single ingredient, **honey** — and
writes it to `/output/entry.png`: a close-up honeycomb slab, a wooden honey
dipper dripping a thick glossy ribbon of honey into a shining pool, in warm
light. Everything is drawn procedurally by the program itself with a tiny
software rasterizer and a hand-rolled PNG encoder. No network, no external
assets, no randomness: two runs produce byte-identical output.

## Run

```sh
node main.ts
```

Writes `entry.png` (1024×1024, ~649 KB) to `$MAKEFUN_OUTPUT_DIR` (default
`/output`). Runs in about 1 second.

## License

MIT — see [LICENSE](LICENSE).
