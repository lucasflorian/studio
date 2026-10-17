/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import React from 'react';
import {connect} from "react-redux";
import { toast } from 'react-toastify';
import {withTranslation} from "react-i18next";
import createEngine, { DefaultDiagramState } from '@projectstorm/react-diagrams';

import StageNodeFactory from "./factories/StageNodeFactory";
import ActionNodeFactory from "./factories/ActionNodeFactory";
import CoverNodeFactory from "./factories/CoverNodeFactory";
import MenuNodeFactory from "./factories/MenuNodeFactory";
import StoryNodeFactory from "./factories/StoryNodeFactory";
import StudioLinkFactory from "./factories/StudioLinkFactory";
import StudioLinkLayerFactory from "./factories/StudioLinkLayerFactory";
import ActionPortFactory from "./factories/ActionPortFactory";
import StagePortFactory from "./factories/StagePortFactory";
import PackDiagramModel from "./models/PackDiagramModel";
import PackDiagramWidget from "./widgets/PackDiagramWidget";
import FixedZoomCanvasAction from "./actions/FixedZoomCanvasAction";
import IssueReportToast from "../IssueReportToast";
import Modal from "../Modal";
import MoreMenu from "../MoreMenu";
import {generateFilename} from "../../utils/packs";
import {writeToArchive} from "../../utils/writer";
import {
    actionLoadPackInEditor,
    actionUploadToLibrary,
    setEditorDiagram
} from "../../actions";

import './PackEditor.css';
import './EditorModern.css';


class PackEditor extends React.Component {

    constructor(props) {
        super(props);

        let engine = createEngine({registerDefaultZoomCanvasAction: false});

        engine.getActionEventBus().registerAction(new FixedZoomCanvasAction());

        // No loose links
        const state = engine.getStateMachine().getCurrentState();
        if (state instanceof DefaultDiagramState) {
            state.dragNewLink.config.allowLooseLinks = false;
        }

        let updateCanvas = () => {
            engine.repaintCanvas();
        };
        engine.getLayerFactories().deregisterFactory('diagram-links');
        engine.getLayerFactories().registerFactory(new StudioLinkLayerFactory());
        engine.getNodeFactories().registerFactory(new StageNodeFactory(updateCanvas));
        engine.getNodeFactories().registerFactory(new ActionNodeFactory(updateCanvas));
        engine.getNodeFactories().registerFactory(new CoverNodeFactory(updateCanvas));
        engine.getNodeFactories().registerFactory(new MenuNodeFactory(updateCanvas));
        engine.getNodeFactories().registerFactory(new StoryNodeFactory(updateCanvas));
        engine.getLinkFactories().registerFactory(new StudioLinkFactory());
        engine.getPortFactories().registerFactory(new StagePortFactory());
        engine.getPortFactories().registerFactory(new ActionPortFactory());

        this.state = {
            engine,
            diagram: null,
            showSaveConfirmDialog: false
        };
    }

    componentDidMount() {
        if (this.props.editor.diagram) {
            let engine = this.state.engine;
            engine.setModel(this.props.editor.diagram);
            this.setState({
                engine,
                diagram: this.props.editor.diagram
            });
        }
    }

    componentWillReceiveProps(nextProps, nextContext) {
        if (nextProps.editor.diagram && nextProps.editor.diagram !== this.state.diagram) {
            let engine = this.state.engine;
            engine.setModel(nextProps.editor.diagram);
            this.setState({
                engine,
                diagram: nextProps.editor.diagram
            }, () => this.state.engine.repaintCanvas());
        }
    }

    savePackToLibrary = () => {
        // Pack path is either stored (when open from library) or generated
        let path = this.props.editor.filename || generateFilename(this.state.engine.getModel());
        // Confirmation dialog if pack already in library
        if (this.props.library.packs.filter(pack => pack.path === path).length > 0) {
            this.showSaveConfirmDialog();
        } else {
            this.doSavePackToLibrary();
        }
    };

    doSavePackToLibrary = () => {
        const { t } = this.props;
        // Pack path is either stored (when open from library) or generated
        let uuid = this.state.engine.getModel().getEntryPoint().getUuid();
        let path = this.props.editor.filename || generateFilename(this.state.engine.getModel());
        // Show toast
        let toastId = toast(t('toasts.editor.saving'), { autoClose: false });
        writeToArchive(this.state.engine.getModel())
            .then(blob => {
                this.props.uploadPackToLibrary(uuid, path, blob)
                    .then(() => toast.update(toastId, { type: toast.TYPE.SUCCESS, render: t('toasts.editor.saved'), autoClose: 5000}));
            })
            .catch(e => {
                console.error('failed to save story pack to library', e);
                toast.update(toastId, { type: toast.TYPE.ERROR, render: <IssueReportToast content={<>{t('toasts.editor.savingFailed')}</>} error={e} />, autoClose: false });
            })
            .finally(() => {
                // Always hide confirmation dialog
                this.dismissSaveConfirmDialog();
            });
    };

    clear = () => {
        let model = new PackDiagramModel();

        this.props.setEditorDiagram(model);
    };

    exportPack = () => {
        const { t } = this.props;
        let toastId = toast(t('toasts.editor.exporting'), { autoClose: false });
        writeToArchive(this.state.engine.getModel())
            .then(blob => {
                toast.update(toastId, { type: toast.TYPE.SUCCESS, render: t('toasts.editor.exported'), autoClose: 5000});
                var a = document.getElementById('download');
                a.href = URL.createObjectURL(blob);
                a.download = this.props.editor.filename || generateFilename(this.state.engine.getModel());
                a.click();
                URL.revokeObjectURL(a.href);
            })
            .catch(e => {
                console.error('failed to export story pack', e);
                toast.update(toastId, { type: toast.TYPE.ERROR, render: <IssueReportToast content={<>{t('toasts.editor.exportingFailed')}</>} error={e} />, autoClose: false });
            });
    };

    showImportFileSelector = () => {
        document.getElementById('upload').click();
    };

    packImportFileSelected = (event) => {
        const { t } = this.props;
        let file = event.target.files[0];
        console.log('Selected import file name = ' + file.name);
        console.log(file.type);
        if (['application/zip', 'application/x-zip-compressed'].indexOf(file.type) === -1) {
            toast.error(t('toasts.editor.loadingWrongType'));
            return;
        }

        this.importPack(file);
    };

    importPack = (file) => {
        this.props.loadPackInEditor(file, file.name);
    };

    showSaveConfirmDialog = () => {
        this.setState({showSaveConfirmDialog: true});
    };

    dismissSaveConfirmDialog = () => {
        this.setState({showSaveConfirmDialog: false});
    };

    render() {
        const { t } = this.props;
        return (
            <div className="custom-pack-editor">
                {this.state.showSaveConfirmDialog &&
                <Modal id="confirm-library-pack-overwrite"
                       title={t('dialogs.editor.save.title')}
                       content={<p>{t('dialogs.editor.save.content')}</p>}
                       buttons={[
                           { label: t('dialogs.shared.no'), onClick: this.dismissSaveConfirmDialog},
                           { label: t('dialogs.shared.yes'), onClick: this.doSavePackToLibrary}
                       ]}
                       onClose={this.dismissSaveConfirmDialog}
                />}
                {this.state.showClearConfirm &&
                <Modal id="confirm-editor-clear"
                       title="Tout effacer ?"
                       content={<p>Le pack en cours d'édition sera vidé. Pense à l'enregistrer d'abord si tu veux le garder.</p>}
                       buttons={[
                           { label: t('dialogs.shared.no'), onClick: () => this.setState({ showClearConfirm: false }) },
                           { label: 'Tout effacer', onClick: () => { this.setState({ showClearConfirm: false }); this.clear(); } }
                       ]}
                       onClose={() => this.setState({ showClearConfirm: false })}
                />}
                <div className="ed-topbar">
                    {/* eslint-disable-next-line */}
                    <a id="download" style={{visibility: 'hidden', position: 'absolute'}} />
                    <input type="file" id="upload" accept=".zip" style={{display: 'none'}} onChange={this.packImportFileSelected} />
                    <div className="ed-topbar-text">
                        <div className="ed-topbar-title">Éditeur de pack</div>
                        <div className="ed-topbar-sub">Glisse des blocs depuis la gauche, relie-les, puis enregistre.</div>
                    </div>
                    <button className="sl-btn sl-btn-primary" onClick={this.savePackToLibrary} title="Ajouter ou mettre à jour ce pack dans la bibliothèque">
                        Enregistrer dans la bibliothèque
                    </button>
                    <MoreMenu items={[
                        { icon: '\uD83D\uDCE5', label: 'Ouvrir un pack (.zip)…', onClick: this.showImportFileSelector },
                        { icon: '\uD83D\uDCBE', label: 'Télécharger le pack (.zip)', onClick: this.exportPack },
                        { divider: true },
                        { icon: '\u2728', label: 'Nouveau pack (tout effacer)', danger: true, onClick: () => this.setState({ showClearConfirm: true }) }
                    ]}/>
                </div>

                <PackDiagramWidget diagramEngine={this.state.engine}/>
            </div>
        );
    }
}

const mapStateToProps = (state, ownProps) => ({
    editor: state.editor,
    library: state.library
});

const mapDispatchToProps = (dispatch, ownProps) => ({
    setEditorDiagram: (diagram) => dispatch(setEditorDiagram(diagram)),
    loadPackInEditor: (packData, filename) => dispatch(actionLoadPackInEditor(packData, filename, ownProps.t)),
    uploadPackToLibrary: (uuid, path, packData) => dispatch(actionUploadToLibrary(uuid, path, packData, ownProps.t))
});

export default withTranslation()(
    connect(
        mapStateToProps,
        mapDispatchToProps
    )(PackEditor)
)
