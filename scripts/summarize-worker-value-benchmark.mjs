#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const run = path.resolve(process.argv[2] ?? "");
if (!run || !fs.existsSync(path.join(run, "candidate-results.json"))) {
  throw new Error("Usage: node scripts/summarize-worker-value-benchmark.mjs <run-directory>");
}

const results = JSON.parse(fs.readFileSync(path.join(run, "candidate-results.json"), "utf8"));
const judgments = new Map();
for (const task of ["relay", "checkout", "archive"]) {
  const source = fs.readFileSync(path.join(run, "review", task, "judgment.md"), "utf8");
  for (const line of source.split("\n")) {
    const match = line.match(/^\| ([a-z]+-\d+) \| (\d+) \| (Yes|No) \|/);
    if (match) judgments.set(`${task}:${match[1]}`, { score: Number(match[2]), qualifies: match[3] === "Yes" });
  }
}

const byModel = new Map();
for (const result of results) {
  const aggregate = byModel.get(result.model) ?? {
    model: result.model,
    runs: 0,
    scores: [],
    qualifyingRuns: 0,
    emptyRuns: 0,
    processFailures: 0,
    implementationPasses: 0,
    requests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    totalTokens: 0,
    recordedCost: 0,
    milliseconds: 0,
  };
  const judgment = judgments.get(`${result.task}:${result.label}`);
  aggregate.runs += 1;
  if (judgment) aggregate.scores.push(judgment.score);
  if (judgment?.qualifies) aggregate.qualifyingRuns += 1;
  if (!result.response.trim()) aggregate.emptyRuns += 1;
  if (result.exitCode !== 0) aggregate.processFailures += 1;
  if (result.task === "archive" && result.check?.code === 0) aggregate.implementationPasses += 1;
  for (const key of ["requests", "input", "output", "cacheRead", "totalTokens"]) aggregate[key] += result.usage[key] ?? 0;
  aggregate.recordedCost += result.usage.recordedCost;
  aggregate.milliseconds += result.milliseconds;
  byModel.set(result.model, aggregate);
}

const summary = [...byModel.values()].map((aggregate) => {
  const sortedScores = [...aggregate.scores].sort((left, right) => left - right);
  return {
    ...aggregate,
    meanScore: aggregate.scores.reduce((sum, score) => sum + score, 0) / aggregate.scores.length,
    medianScore: sortedScores[Math.floor(sortedScores.length / 2)],
    qualifyingRate: aggregate.qualifyingRuns / aggregate.runs,
    implementationPassRate: aggregate.implementationPasses / 3,
    averageRequests: aggregate.requests / aggregate.runs,
    averageOutput: aggregate.output / aggregate.runs,
    averageRecordedCost: aggregate.recordedCost / aggregate.runs,
    recordedCostPerQualifyingRun: aggregate.qualifyingRuns ? aggregate.recordedCost / aggregate.qualifyingRuns : null,
    averageMilliseconds: aggregate.milliseconds / aggregate.runs,
  };
});

const taskSummary = [];
for (const task of ["relay", "checkout", "archive"]) {
  for (const model of [...byModel.keys()]) {
    const selected = results.filter((result) => result.task === task && result.model === model);
    const selectedJudgments = selected.map((result) => judgments.get(`${task}:${result.label}`));
    taskSummary.push({
      task,
      model,
      scores: selectedJudgments.map((judgment) => judgment?.score ?? null),
      qualifyingRuns: selectedJudgments.filter((judgment) => judgment?.qualifies).length,
      implementationPasses: selected.filter((result) => result.check?.code === 0).length,
      requests: selected.reduce((sum, result) => sum + result.usage.requests, 0),
      output: selected.reduce((sum, result) => sum + result.usage.output, 0),
      recordedCost: selected.reduce((sum, result) => sum + result.usage.recordedCost, 0),
    });
  }
}

const output = { run, summary, taskSummary };
fs.writeFileSync(path.join(run, "summary.json"), `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
