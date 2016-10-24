import cosmiconfig from 'cosmiconfig';
import defaultMetadataProvider from 'svgicons2svgfont/src/metadata';
import fileSorter from 'svgicons2svgfont/src/filesorter';
import fs from 'fs';
import globby from 'globby';
import merge from 'merge-deep';
import nunjucks from 'nunjucks';
import path from 'path';
import svg2ttf from 'svg2ttf';
import svgicons2svgfont from 'svgicons2svgfont';
import ttf2eot from 'ttf2eot';
import ttf2woff from 'ttf2woff';
import ttf2woff2 from 'ttf2woff2';

function svgIcons2svgFontFn(files, options, glyphs = []) {
    const fontStream = svgicons2svgfont({
        ascent: options.ascent,
        centerHorizontally: options.centerHorizontally,
        descent: options.descent,
        fixedWidth: options.fixedWidth,
        fontHeight: options.fontHeight,
        fontId: options.fontId,
        fontName: options.fontName,
        fontStyle: options.fontStyle,
        fontWeight: options.fontWeight,
        log: options.log,
        metadata: options.metadata,
        normalize: options.normalize,
        round: options.round
    });
    const metadataProvider = options.metadataProvider || defaultMetadataProvider({
        prependUnicode: options.prependUnicode,
        startUnicode: options.startUnicode
    });

    const sortedFiles = files.sort((fileA, fileB) => fileSorter(fileA, fileB));

    const result = {
        svg: ''
    };

    return Promise.all(
        sortedFiles.map(
            (srcPath) => new Promise((resolve, reject) => {
                metadataProvider(srcPath, (error, metadata) => {
                    if (error) {
                        return reject(new Error(error));
                    }

                    const glyph = fs.createReadStream(srcPath);

                    glyph.metadata = metadata;
                    fontStream.write(glyph);

                    glyphs.push(metadata);

                    return resolve(glyph);
                });
            })
        )
    )
        .then(() => {
            fontStream.end();

            return new Promise((resolve, reject) => {
                fontStream
                    .on('error', (error) => reject(new Error(error)))
                    .on('data', (data) => {
                        result.svg += data;
                    })
                    .on('end', () => resolve(result));
            });
        });
}

function svg2ttfFn(result, options) {
    return new Promise((resolve) => {
        // eslint-disable-next-line node/no-deprecated-api
        result.ttf = new Buffer(svg2ttf(result.svg.toString(), {
            copyright: options.copyright,
            ts: options.ts,
            version: options.version
        }).buffer);

        return resolve(result);
    });
}

function ttf2eotFn(result) {
    return new Promise((resolve) => {
        // eslint-disable-next-line node/no-deprecated-api
        result.eot = new Buffer(ttf2eot(new Uint8Array(result.ttf)).buffer);

        return resolve(result);
    });
}

function ttf2woffFn(result, options) {
    return new Promise((resolve) => {
        // eslint-disable-next-line node/no-deprecated-api
        result.woff = new Buffer(ttf2woff(new Uint8Array(result.ttf), options).buffer);

        return resolve(result);
    });
}

function ttf2woff2Fn(result) {
    return new Promise((resolve) => {
        result.woff2 = ttf2woff2(result.ttf);

        return resolve(result);
    });
}

function buildConfig(options) {
    if (!options.configFile) {
        return Promise.resolve({});
    }

    const cosmiconfigOptions = {
        // Allow extensions on rc filenames
        rcExtensions: true
    };

    let configPath = process.cwd();

    if (options.configFile) {
        configPath = path.resolve(process.cwd(), options.configFile);
    }

    return cosmiconfig('webfont', cosmiconfigOptions)
        .load(null, configPath)
        .then((result) => {
            if (!result) {
                return Promise.reject(new Error('No configuration found'));
            }

            return Promise.resolve({
                config: result.config
            });
        });
}

export default function ({
    files,
    configFile,
    fontName = 'webfont',
    formats = [
        'svg',
        'ttf',
        'eot',
        'woff',
        'woff2'
    ],
    css = false,
    cssFormat = 'css',
    cssTemplateClassName = null,
    cssTemplateFontPath = './',
    cssTemplateFontName = null,
    srcCssTemplate = null,
    formatsOptions = {
        ttf: {
            copyright: null,
            ts: Math.round(Date.now() / 1000)
        }
    },
    metadataProvider = null,
    fontId = null,
    fontStyle = '',
    fontWeight = '',
    fixedWidth = false,
    centerHorizontally = false,
    normalize = false,
    fontHeight = null,
    round = 10e12,
    descent = 0,
    ascent = undefined, // eslint-disable-line no-undefined
    startUnicode = 0xEA01,
    prependUnicode = false,
    metadata = null,
    quite = false
} = {}) {
    if (!files) {
        return Promise.reject(new Error('You must pass webfont a `files` glob'));
    }

    const glyphs = [];

    return buildConfig({
        configFile
    })
        .then((buildedConfig) => {
            const options = merge({}, {
                ascent,
                centerHorizontally,
                css,
                cssFormat,
                cssTemplateClassName,
                cssTemplateFontName,
                cssTemplateFontPath,
                descent,
                fixedWidth,
                fontHeight,
                fontId: !fontId ? fontName : fontId,
                fontName,
                fontStyle,
                fontWeight,
                formats,
                formatsOptions,
                log: quite ? () => {} : console.log, // eslint-disable-line no-console, no-empty-function
                metadata,
                metadataProvider,
                normalize,
                prependUnicode,
                round,
                srcCssTemplate,
                startUnicode
            }, buildedConfig.config);

            return globby([].concat(files))
                .then((foundFiles) => {
                    const filteredFiles = foundFiles.filter(
                        (foundFile) => path.extname(foundFile) === '.svg'
                    );

                    if (filteredFiles.length === 0) {
                        return Promise.reject(new Error('Files glob patterns specified did not match any files'));
                    }

                    return Promise.resolve(filteredFiles);
                })
                .then((foundFiles) => svgIcons2svgFontFn(foundFiles, options, glyphs))
                .then((result) => svg2ttfFn(result, options.formatsOptions.ttf))
                // maybe add ttfautohint
                .then((result) => {
                    if (options.formats.indexOf('eot') === -1) {
                        return Promise.resolve(result);
                    }

                    return ttf2eotFn(result);
                })
                .then((result) => {
                    if (options.formats.indexOf('woff') === -1) {
                        return Promise.resolve(result);
                    }

                    return ttf2woffFn(result, {
                        metadata
                    });
                })
                .then((result) => {
                    if (options.formats.indexOf('woff2') === -1) {
                        return Promise.resolve(result);
                    }

                    return ttf2woff2Fn(result);
                })
                .then((result) => {
                    if (!options.css) {
                        return Promise.resolve(result);
                    }

                    if (!options.srcCssTemplate) {
                        nunjucks.configure(path.join(__dirname, '../'));

                        options.srcCssTemplate = path.join(
                            __dirname,
                            `../templates/template.${options.cssFormat}.njk`
                        );
                    }

                    const nunjucksOptions = merge(
                        {},
                        {
                            glyphs
                        },
                        options,
                        {
                            className: options.cssTemplateClassName
                                ? options.cssTemplateClassName
                                : options.fontName,
                            fontName: options.cssTemplateFontName
                                ? options.cssTemplateFontName
                                : options.fontName,
                            fontPath: options.cssTemplateFontPath
                        }
                    );

                    result.css = nunjucks.render(path.resolve(options.srcCssTemplate), nunjucksOptions);

                    return result;
                })
                .then((result) => {
                    if (options.formats.indexOf('svg') === -1) {
                        delete result.svg;
                    }

                    if (options.formats.indexOf('ttf') === -1) {
                        delete result.ttf;
                    }

                    result.config = options;

                    return Promise.resolve(result);
                });
        })
        .catch((error) => {
            throw error;
        });
}
