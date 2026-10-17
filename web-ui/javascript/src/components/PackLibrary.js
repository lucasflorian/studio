/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import React from 'react';
import { connect } from 'react-redux';
import {withTranslation} from "react-i18next";
import {toast} from "react-toastify";

import {
    actionAddFromLibrary,
    actionRemoveFromDevice,
    actionReorderOnDevice,
    actionAddToLibrary,
    actionDownloadFromLibrary,
    actionLoadPackInEditor,
    actionConvertInLibrary,
    actionRemoveFromLibrary,
    actionUploadToLibrary,
    actionCreatePackInEditor,
    actionLoadSampleInEditor,
    setAllowEnriched
} from "../actions";
import {AppContext} from "../AppContext";
import Modal from "./Modal";
import MoreMenu from "./MoreMenu";
import {
    LOCAL_STORAGE_ALLOW_ENRICHED_BINARY_FORMAT
} from "../utils/storage";

import './PackLibrary.css';

const FORMAT_LABELS = {
    archive: 'Archive modifiable (.zip)',
    raw: 'Format Lunii v1 (brut)',
    fs: 'Format Lunii v2/v3 (FS)'
};

// Délai max d'affichage « Envoi en cours » si l'appareil ne confirme jamais
const SENDING_TIMEOUT_MS = 10 * 60 * 1000;


class PackLibrary extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            device: {
                metadata: null,
                packs: []
            },
            library: {
                metadata: null,
                packs: []
            },
            search: '',
            filter: 'all',
            sending: {},
            copying: {},
            dragOver: false,
            details: null,          // uuid du pack dont on affiche les détails
            showDeviceInfo: false,
            showReorder: false,
            reorderList: [],
            showRemoveFromLibraryConfirmDialog: false,
            removingFromLibrary: null,       // tableau de chemins
            showRemoveFromDeviceConfirmDialog: false,
            removingFromDevice: null,
            allowEnrichedDialog: {
                show: false,
                data: null
            },
            confirmConversionDialog: {
                show: false,
                data: null
            }
        };
    }

    componentDidMount() {
        this.setState({
            device: this.props.device,
            library: this.props.library
        });
    }

    componentWillReceiveProps(nextProps, nextContext) {
        // Un pack qui apparaît sur l'appareil n'est plus « en cours d'envoi »
        let sending = {...this.state.sending};
        (nextProps.device.packs || []).forEach(p => { delete sending[p.uuid]; });
        if (!nextProps.device.metadata) {
            sending = {};
        }
        let copying = {...this.state.copying};
        (nextProps.library.packs || []).forEach(g => { delete copying[g.uuid]; });
        this.setState({
            device: nextProps.device,
            library: nextProps.library,
            sending,
            copying
        });
    }

    componentWillUnmount() {
        Object.values(this.sendingTimers || {}).forEach(clearTimeout);
    }

    /* ---------- Envoi vers la Lunii ---------- */

    devicePack = (uuid) => (this.state.device.packs || []).find(p => p.uuid === uuid);

    isOnDevice = (uuid) => !!this.devicePack(uuid);

    markSending = (uuid, on) => {
        this.sendingTimers = this.sendingTimers || {};
        clearTimeout(this.sendingTimers[uuid]);
        if (on) {
            this.sendingTimers[uuid] = setTimeout(() => this.markSending(uuid, false), SENDING_TIMEOUT_MS);
        }
        this.setState(state => {
            const sending = {...state.sending};
            if (on) { sending[uuid] = true; } else { delete sending[uuid]; }
            return { sending };
        });
    };

    sendToDevice = (group) => {
        const driver = this.state.device.metadata && this.state.device.metadata.driver;
        if (!driver) {
            return;
        }
        // Le pack le plus récent
        const latestPack = group.packs[0];
        // Le pack le plus récent déjà au bon format pour cet appareil
        const compatiblePack = group.packs.find(p => p.format === driver);

        if (compatiblePack == null) {
            // Aucun fichier compatible : on convertit d'abord le plus récent
            if (driver === 'raw' && localStorage.getItem(LOCAL_STORAGE_ALLOW_ENRICHED_BINARY_FORMAT) === null) {
                this.setState({
                    allowEnrichedDialog: {
                        show: true,
                        data: { pack: {...latestPack, format: driver}, format: driver, addToDevice: true }
                    }
                });
            } else {
                this.markSending(group.uuid, true);
                this.props.convertPackInLibrary(latestPack.uuid, latestPack.path, driver, this.props.settings.allowEnriched, this.context)
                    .then(path => {
                        if (path) {
                            this.doAddToDevice({...latestPack, format: driver}, path);
                        } else {
                            this.markSending(group.uuid, false);
                        }
                    })
                    .catch(() => this.markSending(group.uuid, false));
            }
        } else if (latestPack.timestamp > compatiblePack.timestamp) {
            // Le fichier compatible est plus ancien que la dernière version : demander s'il faut reconvertir
            this.setState({
                confirmConversionDialog: {
                    show: true,
                    data: { pack: {...latestPack, format: driver}, format: driver, fallback: compatiblePack }
                }
            });
        } else {
            this.doAddToDevice(compatiblePack, compatiblePack.path);
        }
    };

    doAddToDevice = (data, path) => {
        this.markSending(data.uuid, true);
        return this.props.addFromLibrary(data.uuid, path, data.format, this.state.device.metadata.driver, this.context);
    };

    dismissEnrichedDialog = (allow) => {
        return () => {
            const data = this.state.allowEnrichedDialog.data;
            this.setState({ allowEnrichedDialog: { show: false, data: null } });
            this.props.setAllowEnriched(allow);
            if (data.addToDevice) {
                this.markSending(data.pack.uuid, true);
            }
            this.props.convertPackInLibrary(data.pack.uuid, data.pack.path, data.format, allow, this.context)
                .then(path => {
                    if (data.addToDevice && path) {
                        return this.doAddToDevice(data.pack, path);
                    }
                    this.markSending(data.pack.uuid, false);
                });
        }
    };

    dismissConfirmConversionDialog = (answer) => {
        return () => {
            const data = this.state.confirmConversionDialog.data;
            this.setState({ confirmConversionDialog: { show: false, data: null } });
            if (answer) {
                this.markSending(data.pack.uuid, true);
                this.props.convertPackInLibrary(data.pack.uuid, data.pack.path, data.format, this.props.settings.allowEnriched, this.context)
                    .then(path => path ? this.doAddToDevice(data.pack, path) : this.markSending(data.pack.uuid, false));
            } else if (data.fallback) {
                // Envoyer quand même l'ancien fichier compatible
                this.doAddToDevice(data.fallback, data.fallback.path);
            }
        }
    };

    /* ---------- Retirer de la Lunii ---------- */

    onRemovePackFromDevice = (uuid) => {
        this.setState({removingFromDevice: uuid, showRemoveFromDeviceConfirmDialog: true});
    };

    doRemovePackFromDevice = () => {
        this.props.removeFromDevice(this.state.removingFromDevice)
            .finally(() => this.dismissRemoveFromDeviceConfirmDialog());
    };

    dismissRemoveFromDeviceConfirmDialog = () => {
        this.setState({showRemoveFromDeviceConfirmDialog: false});
    };

    /* ---------- Ordre des packs sur la Lunii ---------- */

    openReorder = () => {
        this.setState({ showReorder: true, reorderList: [...this.state.device.packs] });
    };

    moveInReorder = (idx, delta) => {
        const list = [...this.state.reorderList];
        const target = idx + delta;
        if (target < 0 || target >= list.length) {
            return;
        }
        [list[idx], list[target]] = [list[target], list[idx]];
        this.setState({ reorderList: list });
    };

    saveReorder = () => {
        const before = this.state.device.packs.map(p => p.uuid).join(',');
        const after = this.state.reorderList.map(p => p.uuid);
        if (before !== after.join(',')) {
            this.props.reorderOnDevice(after);
        }
        this.setState({ showReorder: false });
    };

    /* ---------- Bibliothèque ---------- */

    getDroppedFile = (event) => {
        if (event.dataTransfer.items && event.dataTransfer.items.length) {
            return event.dataTransfer.items[0].kind === 'file' ? event.dataTransfer.items[0].getAsFile() : null;
        }
        return event.dataTransfer.files && event.dataTransfer.files[0];
    };

    onDropIntoLibrary = (event) => {
        event.preventDefault();
        this.setState({ dragOver: false });
        const file = this.getDroppedFile(event);
        if (file) {
            this.addPackToLibrary(file);
        }
    };

    showAddFileSelector = () => {
        document.getElementById('upload').click();
    };

    packAddFileSelected = (event) => {
        const file = event.target.files[0];
        this.addPackToLibrary(file);
        event.target.value = '';
    };

    addPackToLibrary = (file) => {
        const { t } = this.props;
        if (!file) {
            return;
        }
        if (['application/zip', 'application/x-zip-compressed'].indexOf(file.type) === -1 && !file.name.endsWith('.pack') && !file.name.endsWith('.zip')) {
            toast.error(t('toasts.library.packFileWrongType'));
            return;
        }
        this.props.uploadPackToLibrary(file.name, file);
    };

    convertLibraryPack = (pack, format) => {
        if (format === 'raw' && localStorage.getItem(LOCAL_STORAGE_ALLOW_ENRICHED_BINARY_FORMAT) === null) {
            this.setState({
                allowEnrichedDialog: {
                    show: true,
                    data: { pack, format, addToDevice: false }
                }
            });
            return;
        }
        this.props.convertPackInLibrary(pack.uuid, pack.path, format, this.props.settings.allowEnriched, this.context);
    };

    editLibraryPack = (pack) => {
        this.props.downloadPackFromLibrary(pack.uuid, pack.path)
            .then(packFile => this.props.loadPackInEditor(packFile, pack.path));
    };

    copyDevicePackToLibrary = (pack) => {
        this.setState(state => ({ copying: {...state.copying, [pack.uuid]: true} }));
        const done = () => this.setState(state => {
            const copying = {...state.copying};
            delete copying[pack.uuid];
            return { copying };
        });
        // Sécurité : on libère le bouton au bout de 10 minutes si rien ne revient
        setTimeout(done, SENDING_TIMEOUT_MS);
        Promise.resolve(this.props.addToLibrary(pack.uuid, this.state.device.metadata.driver, this.context)).catch(done);
    };

    onRemovePacksFromLibrary = (paths) => {
        this.setState({removingFromLibrary: paths, showRemoveFromLibraryConfirmDialog: true});
    };

    doRemovePacksFromLibrary = () => {
        const paths = this.state.removingFromLibrary || [];
        paths.reduce((p, path) => p.then(() => this.props.removeFromLibrary(path)), Promise.resolve())
            .finally(() => this.dismissRemoveFromLibraryConfirmDialog());
    };

    dismissRemoveFromLibraryConfirmDialog = () => {
        this.setState({showRemoveFromLibraryConfirmDialog: false, removingFromLibrary: null});
    };

    copyToClipboard = (text) => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => toast.info('Copié dans le presse-papiers', { autoClose: 2000 }));
        }
    };

    /* ---------- Rendu ---------- */

    renderThumb(pack, size) {
        return <div className={`sl-thumb sl-thumb-${size}`}>
            {pack && pack.image
                ? <img src={pack.image} alt="" draggable={false}/>
                : <span className="sl-thumb-placeholder" aria-hidden="true">&#128214;</span>}
        </div>;
    }

    renderGroupCard(group) {
        const latest = group.packs[0];
        const plugged = !!this.state.device.metadata;
        const onDevice = this.isOnDevice(group.uuid);
        const sending = !!this.state.sending[group.uuid];
        const official = !!latest.official;
        const archive = group.packs.find(p => p.format === 'archive');
        const title = latest.title || group.uuid;

        let action;
        if (sending) {
            action = <button className="sl-btn sl-btn-primary" disabled><span className="sl-spinner"/>Envoi en cours…</button>;
        } else if (onDevice) {
            action = <div className="sl-on-device"><span className="sl-check">&#10003;</span>Sur la Lunii</div>;
        } else if (official) {
            action = <div className="sl-muted-note" title="Les packs officiels s'installent avec l'application Luniistore">Pack officiel</div>;
        } else {
            action = <button className="sl-btn sl-btn-primary"
                             disabled={!plugged}
                             title={plugged ? 'Copier cette histoire sur la Lunii' : 'Branche ta Lunii et allume-la pour envoyer'}
                             onClick={() => this.sendToDevice(group)}>
                Envoyer sur la Lunii
            </button>;
        }

        const items = [
            archive
                ? { icon: '✏️', label: 'Modifier dans l\'éditeur', onClick: () => this.editLibraryPack(archive) }
                : (!official && { icon: '✏️', label: 'Rendre modifiable', hint: 'Crée une copie au format archive, ouvrable dans l\'éditeur', onClick: () => this.convertLibraryPack(latest, 'archive') }),
            onDevice && plugged && { icon: '⏏️', label: 'Retirer de la Lunii', onClick: () => this.onRemovePackFromDevice(group.uuid) },
            { icon: 'ℹ️', label: 'Fichiers et formats…', onClick: () => this.setState({ details: group.uuid }) },
            { divider: true },
            { icon: '🗑️', label: 'Supprimer de la bibliothèque', danger: true, onClick: () => this.onRemovePacksFromLibrary(group.packs.map(p => p.path)) }
        ];

        return <div key={group.uuid} className={`sl-card ${onDevice ? 'is-on-device' : ''}`}>
            <div className="sl-card-media">
                {this.renderThumb(latest, 'lg')}
                {onDevice && <span className="sl-badge sl-badge-success">Sur la Lunii</span>}
                {official && <span className="sl-badge sl-badge-official">Officiel</span>}
                {latest.nightModeAvailable && <span className="sl-badge sl-badge-night" role="img" aria-label="Mode nuit disponible" title="Mode nuit disponible">&#127769;</span>}
            </div>
            <div className="sl-card-body">
                <div className="sl-card-title" title={title}>{title}</div>
                <div className="sl-card-footer">
                    {action}
                    <MoreMenu items={items}/>
                </div>
            </div>
        </div>;
    }

    renderDeviceOnlyCard(pack) {
        const title = pack.title || pack.uuid;
        const items = [
            !pack.official && { icon: '📥', label: 'Copier dans la bibliothèque', onClick: () => this.copyDevicePackToLibrary(pack) },
            { icon: '⏏️', label: 'Retirer de la Lunii', danger: true, onClick: () => this.onRemovePackFromDevice(pack.uuid) }
        ];
        return <div key={pack.uuid} className="sl-card is-on-device">
            <div className="sl-card-media">
                {this.renderThumb(pack, 'lg')}
                <span className="sl-badge sl-badge-success">Sur la Lunii</span>
                {pack.official && <span className="sl-badge sl-badge-official">Officiel</span>}
            </div>
            <div className="sl-card-body">
                <div className="sl-card-title" title={title}>{title}</div>
                <div className="sl-card-footer">
                    {pack.official
                        ? <div className="sl-muted-note" title="Les packs officiels sont protégés : ils ne peuvent pas être copiés depuis la Lunii">Pack officiel</div>
                        : this.state.copying[pack.uuid]
                            ? <button className="sl-btn sl-btn-secondary" disabled><span className="sl-spinner sl-spinner-dark"/>Récupération…</button>
                            : <button className="sl-btn sl-btn-secondary"
                                      title="Copier cette histoire de la Lunii vers la bibliothèque de l'ordinateur"
                                      onClick={() => this.copyDevicePackToLibrary(pack)}>
                                Récupérer dans la bibliothèque
                            </button>}
                    <MoreMenu items={items}/>
                </div>
            </div>
        </div>;
    }

    renderDeviceBar() {
        const md = this.state.device.metadata;
        if (!md) {
            return <div className="sl-device sl-device-off">
                <div className="sl-device-icon" aria-hidden="true">&#128268;</div>
                <div className="sl-device-text">
                    <div className="sl-device-title">Aucune Lunii connectée</div>
                    <div className="sl-device-sub">Branche ta Lunii en USB, puis allume-la.</div>
                </div>
            </div>;
        }
        const pct = Math.round(100 * md.storage.taken / md.storage.size);
        const count = this.state.device.packs.length;
        return <div className="sl-device sl-device-on">
            <div className="sl-device-icon" aria-hidden="true">&#127911;</div>
            <div className="sl-device-text">
                <div className="sl-device-title">Lunii connectée</div>
                <div className="sl-device-sub">{count} histoire{count > 1 ? 's' : ''} · {pct}% de la mémoire utilisée{md.error ? ' · erreurs détectées' : ''}</div>
                <div className="sl-meter"><div className="sl-meter-fill" style={{width: pct + '%'}}/></div>
            </div>
            <MoreMenu items={[
                { icon: '↕️', label: 'Changer l\'ordre des histoires', onClick: this.openReorder },
                { icon: 'ℹ️', label: 'Infos de l\'appareil', onClick: () => this.setState({ showDeviceInfo: true }) }
            ]}/>
        </div>;
    }

    renderSheet(title, onClose, body, footer) {
        return <div className="sl-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="sl-sheet" role="dialog" aria-label={title}>
                <div className="sl-sheet-head">
                    <h3>{title}</h3>
                    <button className="sl-icon-btn" onClick={onClose} aria-label="Fermer">&times;</button>
                </div>
                <div className="sl-sheet-body">{body}</div>
                {footer && <div className="sl-sheet-foot">{footer}</div>}
            </div>
        </div>;
    }

    renderDetails() {
        const group = this.state.library.packs.find(g => g.uuid === this.state.details);
        if (!group) {
            return null;
        }
        const close = () => this.setState({ details: null });
        const official = !!group.packs[0].official;
        const body = <>
            <div className="sl-details-head">
                {this.renderThumb(group.packs[0], 'md')}
                <div>
                    <div className="sl-details-title">{group.packs[0].title || group.uuid}</div>
                    <div className="sl-details-uuid">
                        <code>{group.uuid}</code>
                        <button className="sl-link" onClick={() => this.copyToClipboard(group.uuid)}>Copier</button>
                    </div>
                </div>
            </div>
            <p className="sl-help">Une même histoire peut exister en plusieurs fichiers : une archive modifiable et des versions converties pour la Lunii. STUdio choisit automatiquement le bon fichier à l'envoi.</p>
            <div className="sl-files">
                {group.packs.map((p, idx) => <div key={p.path} className="sl-file">
                    <div className="sl-file-main">
                        <div className="sl-file-format">
                            {FORMAT_LABELS[p.format] || p.format}
                            <span className="sl-chip">v{p.version}</span>
                            {idx === 0 && <span className="sl-chip sl-chip-accent">plus récent</span>}
                        </div>
                        <div className="sl-file-path" title={p.path}>{p.path}</div>
                    </div>
                    <MoreMenu items={[
                        p.format === 'archive' && { icon: '✏️', label: 'Ouvrir dans l\'éditeur', onClick: () => { close(); this.editLibraryPack(p); } },
                        p.format !== 'archive' && !official && { icon: '🗜️', label: 'Convertir en archive modifiable', onClick: () => this.convertLibraryPack(p, 'archive') },
                        p.format === 'archive' && { icon: '📂', label: 'Convertir au format Lunii v2/v3 (FS)', onClick: () => this.convertLibraryPack(p, 'fs') },
                        p.format === 'archive' && { icon: '📦', label: 'Convertir au format Lunii v1 (brut)', onClick: () => this.convertLibraryPack(p, 'raw') },
                        { divider: true },
                        { icon: '🗑️', label: 'Supprimer ce fichier', danger: true, onClick: () => this.onRemovePacksFromLibrary([p.path]) }
                    ]}/>
                </div>)}
            </div>
        </>;
        return this.renderSheet('Fichiers et formats', close, body);
    }

    renderDeviceInfo() {
        const md = this.state.device.metadata;
        if (!md) {
            return null;
        }
        const close = () => this.setState({ showDeviceInfo: false });
        const mb = (b) => (b / 1024 / 1024).toFixed(0) + ' Mo';
        const body = <dl className="sl-dl">
            <dt>Numéro de série</dt><dd>{md.serial || '-'}</dd>
            <dt>Firmware</dt><dd>{md.firmware || '-'}</dd>
            <dt>Format des packs</dt><dd>{FORMAT_LABELS[md.driver] || md.driver}</dd>
            <dt>Mémoire</dt><dd>{mb(md.storage.taken)} utilisés sur {mb(md.storage.size)}</dd>
            <dt>UUID</dt><dd><code>{md.uuid}</code></dd>
            {md.error && <><dt>État</dt><dd className="sl-text-danger">L'appareil signale des erreurs</dd></>}
        </dl>;
        return this.renderSheet('Infos de la Lunii', close, body);
    }

    renderReorder() {
        const close = () => this.setState({ showReorder: false });
        const body = <>
            <p className="sl-help">L'ordre ci-dessous est celui dans lequel ta fille fait défiler les histoires sur la Lunii.</p>
            <ol className="sl-reorder">
                {this.state.reorderList.map((p, idx) => <li key={p.uuid}>
                    {this.renderThumb(p, 'sm')}
                    <span className="sl-reorder-title">{p.title || p.uuid}</span>
                    <button className="sl-icon-btn" disabled={idx === 0} onClick={() => this.moveInReorder(idx, -1)} aria-label="Monter">&#8593;</button>
                    <button className="sl-icon-btn" disabled={idx === this.state.reorderList.length - 1} onClick={() => this.moveInReorder(idx, 1)} aria-label="Descendre">&#8595;</button>
                </li>)}
            </ol>
        </>;
        const footer = <>
            <button className="sl-btn sl-btn-ghost" onClick={close}>Annuler</button>
            <button className="sl-btn sl-btn-primary" onClick={this.saveReorder}>Enregistrer l'ordre</button>
        </>;
        return this.renderSheet('Ordre des histoires sur la Lunii', close, body, footer);
    }

    render() {
        const { t } = this.props;
        const plugged = !!this.state.device.metadata;
        const groups = this.state.library.packs || [];
        const q = this.state.search.trim().toLowerCase();
        const matches = (title) => !q || (title || '').toLowerCase().indexOf(q) !== -1;

        const libraryUuids = new Set(groups.map(g => g.uuid));
        const onDeviceCount = groups.filter(g => this.isOnDevice(g.uuid)).length;
        const deviceOnly = (this.state.device.packs || []).filter(p => !libraryUuids.has(p.uuid));

        const visibleGroups = groups
            .filter(g => matches(g.packs[0].title || g.uuid))
            .filter(g => this.state.filter === 'all'
                || (this.state.filter === 'device' && this.isOnDevice(g.uuid))
                || (this.state.filter === 'notDevice' && !this.isOnDevice(g.uuid)));
        const visibleDeviceOnly = this.state.filter === 'notDevice' ? [] : deviceOnly.filter(p => matches(p.title || p.uuid));
        const visibleOnDevice = visibleGroups.filter(g => this.isOnDevice(g.uuid));
        const visibleNotOnDevice = visibleGroups.filter(g => !this.isOnDevice(g.uuid));

        const filters = [
            { key: 'all', label: 'Toutes', count: groups.length },
            plugged && { key: 'device', label: 'Sur la Lunii', count: onDeviceCount },
            plugged && { key: 'notDevice', label: 'Pas encore sur la Lunii', count: groups.length - onDeviceCount }
        ].filter(Boolean);

        return (
            <div className="sl-library"
                 onDragOver={e => { e.preventDefault(); if (!this.state.dragOver) this.setState({ dragOver: true }); }}
                 onDragLeave={e => { if (e.currentTarget === e.target) this.setState({ dragOver: false }); }}
                 onDrop={this.onDropIntoLibrary}>

                {this.state.showRemoveFromDeviceConfirmDialog &&
                <Modal id="confirm-device-pack-remove"
                       title="Retirer de la Lunii ?"
                       content={<p>L'histoire sera effacée de la Lunii. Elle reste dans ta bibliothèque, tu pourras la renvoyer plus tard.</p>}
                       buttons={[
                           { label: t('dialogs.shared.no'), onClick: this.dismissRemoveFromDeviceConfirmDialog},
                           { label: 'Retirer', onClick: this.doRemovePackFromDevice}
                       ]}
                       onClose={this.dismissRemoveFromDeviceConfirmDialog}
                />}
                {this.state.showRemoveFromLibraryConfirmDialog &&
                <Modal id="confirm-library-pack-remove"
                       title="Supprimer de la bibliothèque ?"
                       content={<p>{(this.state.removingFromLibrary || []).length > 1
                           ? `Les ${this.state.removingFromLibrary.length} fichiers de cette histoire seront supprimés de ton ordinateur.`
                           : 'Ce fichier sera supprimé de ton ordinateur.'} Ce qui est déjà sur la Lunii n'est pas touché.</p>}
                       buttons={[
                           { label: t('dialogs.shared.no'), onClick: this.dismissRemoveFromLibraryConfirmDialog},
                           { label: 'Supprimer', onClick: this.doRemovePacksFromLibrary}
                       ]}
                       onClose={this.dismissRemoveFromLibraryConfirmDialog}
                />}
                {this.state.allowEnrichedDialog.show &&
                <Modal id="ask-allow-enriched"
                       title={t('dialogs.library.askAllowEnriched.title')}
                       content={<div dangerouslySetInnerHTML={{__html: t('dialogs.library.askAllowEnriched.content')}} ></div>}
                       buttons={[
                           { label: t('dialogs.shared.no'), onClick: this.dismissEnrichedDialog(false)},
                           { label: t('dialogs.shared.yes'), onClick: this.dismissEnrichedDialog(true)}
                       ]}
                       onClose={this.dismissEnrichedDialog(false)}
                />}
                {this.state.confirmConversionDialog.show &&
                <Modal id="ask-confirm-conversion"
                       title="Une version plus récente existe"
                       content={<p>Cette histoire a été modifiée depuis sa dernière préparation pour la Lunii. Préparer et envoyer la nouvelle version ? (Non : envoie l'ancienne version.)</p>}
                       buttons={[
                           { label: t('dialogs.shared.no'), onClick: this.dismissConfirmConversionDialog(false)},
                           { label: t('dialogs.shared.yes'), onClick: this.dismissConfirmConversionDialog(true)}
                       ]}
                       onClose={() => this.setState({ confirmConversionDialog: { show: false, data: null } })}
                />}
                {this.state.details && this.renderDetails()}
                {this.state.showDeviceInfo && this.renderDeviceInfo()}
                {this.state.showReorder && this.renderReorder()}

                <div className="sl-container">
                    {this.renderDeviceBar()}

                    <div className="sl-toolbar">
                        <div className="sl-search">
                            <span className="sl-search-icon" aria-hidden="true">&#128269;</span>
                            <input type="search"
                                   placeholder="Rechercher une histoire"
                                   value={this.state.search}
                                   onChange={e => this.setState({ search: e.target.value })}/>
                        </div>
                        <div className="sl-filters" role="tablist">
                            {filters.map(f => <button key={f.key}
                                                      role="tab"
                                                      aria-selected={this.state.filter === f.key}
                                                      className={`sl-filter ${this.state.filter === f.key ? 'is-active' : ''}`}
                                                      onClick={() => this.setState({ filter: f.key })}>
                                {f.label}<span className="sl-filter-count">{f.count}</span>
                            </button>)}
                        </div>
                        <div className="sl-toolbar-actions">
                            <input type="file" id="upload" accept=".zip,.pack" style={{display: 'none'}} onChange={this.packAddFileSelected} />
                            <button className="sl-btn sl-btn-secondary" onClick={this.showAddFileSelector}>+ Importer un pack</button>
                            <MoreMenu items={[
                                { icon: '✨', label: 'Créer un nouveau pack', onClick: () => this.props.createPackInEditor() },
                                { icon: '📖', label: 'Ouvrir le pack d\'exemple', onClick: () => this.props.loadSampleInEditor() },
                                this.state.library.metadata && { divider: true },
                                this.state.library.metadata && { icon: '📁', label: 'Copier le chemin de la bibliothèque', hint: this.state.library.metadata.path, onClick: () => this.copyToClipboard(this.state.library.metadata.path) }
                            ]}/>
                        </div>
                    </div>

                    {groups.length === 0 && <div className="sl-empty">
                        <div className="sl-empty-icon" aria-hidden="true">&#128218;</div>
                        <h3>Ta bibliothèque est vide</h3>
                        <p>Glisse un pack (.zip) ici, ou utilise « Importer un pack ».</p>
                    </div>}

                    {groups.length > 0 && visibleGroups.length === 0 && visibleDeviceOnly.length === 0 && <div className="sl-empty sl-empty-small">
                        <p>Aucune histoire ne correspond.</p>
                    </div>}

                    {!plugged && visibleGroups.length > 0 && <div className="sl-grid">
                        {visibleGroups.map(g => this.renderGroupCard(g))}
                    </div>}

                    {plugged && visibleOnDevice.length > 0 && <>
                        <h2 className="sl-section-title sl-section-first">Sur la Lunii <span className="sl-filter-count">{visibleOnDevice.length}</span></h2>
                        <div className="sl-grid">
                            {visibleOnDevice.map(g => this.renderGroupCard(g))}
                        </div>
                    </>}

                    {plugged && visibleDeviceOnly.length > 0 && <>
                        <h2 className="sl-section-title">Seulement sur la Lunii <span className="sl-filter-count">{visibleDeviceOnly.length}</span></h2>
                        <p className="sl-section-sub">Ces histoires sont sur la Lunii mais pas dans ta bibliothèque. Tu peux les récupérer sur l'ordinateur (sauf les packs officiels, qui sont protégés).</p>
                        <div className="sl-grid">
                            {visibleDeviceOnly.map(p => this.renderDeviceOnlyCard(p))}
                        </div>
                    </>}

                    {plugged && visibleNotOnDevice.length > 0 && <>
                        <h2 className="sl-section-title">Pas encore sur la Lunii <span className="sl-filter-count">{visibleNotOnDevice.length}</span></h2>
                        <p className="sl-section-sub">Ces histoires sont dans ta bibliothèque. Clique sur « Envoyer sur la Lunii » pour les ajouter.</p>
                        <div className="sl-grid">
                            {visibleNotOnDevice.map(g => this.renderGroupCard(g))}
                        </div>
                    </>}
                </div>

                {this.state.dragOver && <div className="sl-dropzone-hint">Dépose le pack pour l'ajouter à la bibliothèque</div>}
            </div>
        );
    }
}

PackLibrary.contextType = AppContext;

const mapStateToProps = (state, ownProps) => ({
    device: state.device,
    library: state.library,
    settings: state.settings
});

const mapDispatchToProps = (dispatch, ownProps) => ({
    addFromLibrary: (uuid, path, format, driver, context) => dispatch(actionAddFromLibrary(uuid, path, format, driver, context, ownProps.t)),
    removeFromDevice: (uuid) => dispatch(actionRemoveFromDevice(uuid, ownProps.t)),
    reorderOnDevice: (uuids) => dispatch(actionReorderOnDevice(uuids, ownProps.t)),
    addToLibrary: (uuid, driver, context) => dispatch(actionAddToLibrary(uuid, driver, context, ownProps.t)),
    downloadPackFromLibrary: (uuid, path) => dispatch(actionDownloadFromLibrary(uuid, path, ownProps.t)),
    loadPackInEditor: (packData, filename) => dispatch(actionLoadPackInEditor(packData, filename, ownProps.t)),
    convertPackInLibrary: (uuid, path, format, allowEnriched, context) => dispatch(actionConvertInLibrary(uuid, path, format, allowEnriched, context, ownProps.t)),
    removeFromLibrary: (path) => dispatch(actionRemoveFromLibrary(path, ownProps.t)),
    uploadPackToLibrary: (path, packData) => dispatch(actionUploadToLibrary(null, path, packData, ownProps.t)),
    createPackInEditor: () => dispatch(actionCreatePackInEditor(ownProps.t)),
    loadSampleInEditor: () => dispatch(actionLoadSampleInEditor(ownProps.t)),
    setAllowEnriched: (allowEnriched) => dispatch(setAllowEnriched(allowEnriched))
});

export default withTranslation()(
    connect(
        mapStateToProps,
        mapDispatchToProps
    )(PackLibrary)
)
