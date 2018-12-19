#!/usr/bin/env node
/* eslint-disable no-param-reassign, no-console */
const postcssScss = require('postcss-scss');
const { camelCase } = require('lodash');
const selectorToLiteral = require('./selector-to-literal');

// TODO make CLI option
const FE_BRARY_PREFIX = '$fe-brary-';

function placeHolderToVar(str) {
  return camelCase(str.slice(1));
}

function mixinParamsToFunc(str) {
  const [funcName, inputs] = str.split('(');
  return `${camelCase(funcName)}(${inputs.replace(/\$/g, '')}`;
}

function handleSassVar(value, root) {
  if (value.startsWith(FE_BRARY_PREFIX)) {
    root.usesVars = true;

    const [, name] = value.split(FE_BRARY_PREFIX);
    const [field, ...varNameSegs] = name.split(('-'));
    const varName = camelCase(varNameSegs.join('-'));
    return `\${vars.${field}.${varName}}`;
  }

  if (value.startsWith('$')) {
    return `\${${value.slice(1)}}`;
  }

  return value;
}

const processRoot = (root) => {
  root.classes = new Map();
  root.usesVars = false;

  root.walkAtRules('mixin', (atRule) => {
    const { params } = atRule;
    const selector = mixinParamsToFunc(params);

    root.classes.set(
      selector,
      {
        type: 'mixin',
        contents: '',
      },
    );

    // TODO nested media queries
    atRule.walkDecls((decl) => {
      const value = handleSassVar(decl.value, root);

      root.classes.get(
        selector,
      ).contents = `${root.classes.get(selector).contents}\n    ${decl.prop}: ${value};`;
    });
  });

  root.walkRules((rule) => {
    let selector;

    const isPlaceHolder = rule.selector[0] === '%';

    if (isPlaceHolder) {
      selector = placeHolderToVar(rule.selector);
    } else {
      selector = selectorToLiteral(rule.selector);
    }

    root.classes.set(
      selector,
      {
        type: isPlaceHolder ? 'placeholder' : 'class',
        contents: '',
      },
    );

    rule.walkAtRules('extend', (atRule) => {
      root.classes.get(
        selector,
      ).contents = `${root.classes.get(selector).contents}\n  \${${placeHolderToVar(atRule.params)}};`;
    });

    rule.walkAtRules('include', (atRule) => {
      const [funcName, inputs] = atRule.params.split('(');
      const funcCall = `${camelCase(funcName)}('${inputs.slice(0, -1).split(', ').join("', '")}')`;
      root.classes.get(
        selector,
      ).contents = `${root.classes.get(selector).contents}\n  \${${funcCall}};`;
    });

    rule.walkDecls((decl) => {
      let { value } = decl;

      value = handleSassVar(value, root);

      root.classes.get(
        selector,
      ).contents = `${root.classes.get(selector).contents}\n  ${decl.prop}: ${value};`;
    });
  });
};

module.exports = async (cssString, filePath) => {
  const root = postcssScss.parse(cssString, { from: filePath, syntax: postcssScss });

  processRoot(root);

  // let result = '';
  // postcss.stringify(root, (i) => {
  //   result += i;
  // });
  // console.log(result);

  const emotionExports = Array.from(root.classes.entries())
    .reduce((acc, [name, { contents, type }]) => {
      if (type === 'mixin') {
        return `${acc}\nfunction ${name} {\n  return css\`${contents}\n  \`;\n}\n`;
      }

      return `${acc}\n${type === 'class' ? 'export ' : ''}const ${name} = css\`${contents}\n\`;\n`;
    }, '');

  return `import { css } from 'emotion';${root.usesVars ? '\nimport { variables as vars } from \'@domain-group/fe-brary\';' : ''}\n${emotionExports}`;
};
