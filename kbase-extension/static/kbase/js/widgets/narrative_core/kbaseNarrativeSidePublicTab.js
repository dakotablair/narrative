/*global define*/
/*jslint white: true*/
/**
 * "Import" tab on data side panel.
 * @author Roman Sutormin <rsutormin@lbl.gov>
 * @public
 */
define ([
    'kbwidget',
    'bootstrap',
    'handlebars',
    'jquery',
    'bluebird',
    'narrativeConfig',
    'kbaseAuthenticatedWidget',
    'base/js/namespace',
    'kbase-generic-client-api',
    'util/icon',
    'util/string',
    'util/bootstrapDialog',
    'text!kbase/templates/data_slideout/object_row.html',
    'text!kbase/templates/data_slideout/action_button_partial.html',
    'text!kbase/templates/data_slideout/jgi_data_policy.html',
    'text!kbase/templates/data_slideout/data_policy_panel.html'
], function (
    KBWidget,
    bootstrap,
    Handlebars,
    $,
    Promise,
    Config,
    kbaseAuthenticatedWidget,
    Jupyter,
    GenericClient,
    Icon,
    StringUtil,
    BootstrapDialog,
    StagingRowHtml,
    ActionButtonHtml,
    JGIDataPolicyHtml,
    DataPolicyPanelHtml
) {
    'use strict';
    return KBWidget({
        name: 'kbaseNarrativeSidePublicTab',
        parent : kbaseAuthenticatedWidget,
        version: '1.0.0',
        options: {
            $importStatus:$('<div>'),
            addToNarrativeButton: null,
            selectedItems: null,
            lp_url: Config.url('landing_pages'),
            ws_name: null
        },
        token: null,
        wsName: null,
        searchUrlPrefix: Config.url('search'),
        loadingImage: Config.get('loading_gif'),
        wsUrl: Config.url('workspace'),
        wsClient: null,
        serviceClient: null,
        mainListPanelHeight: '535px',
        maxNameLength: 60,
        totalPanel: null,
        resultPanel: null,
        objectList: null,
        currentCategory: null,
        currentQuery: null,
        currentPage: null,
        totalResults: null,
        itemsPerPage: 20,
        maxAutoCopyCount: 1,

        init: function(options) {
            this._super(options);

            this.data_icons = Config.get('icons').data;
            this.icon_colors = Config.get('icons').colors;
            this.wsName = Jupyter.narrative.getWorkspaceName();
            this.categoryDescr = Config.get('publicCategories');
            if (Config.get('features').jgiPublicStaging) {
                this.categoryDescr['jgi_gateway'] = {
                    name: 'JGI Public Data (TEST)',
                    type: null,
                    ws: null,
                    search: false,
                    source: 'jgi_gateway'
                };
            }
            if (this.categoryDescr)
                this.categories = Object.keys(this.categoryDescr);

            Handlebars.registerPartial('actionPartial', ActionButtonHtml);
            this.stagingRowTmpl = Handlebars.compile(StagingRowHtml);

            return this;
        },

        render: function() {
            if ((!this.token) || (!this.wsName))
                return;
            this.infoPanel = $('<div>');
            this.dataPolicyPanel = $('<div>');
            this.$elem.empty()
                .append(this.infoPanel)
                .append(this.dataPolicyPanel);
            if (!this.categories) {
                this.showError('Unable to load public data configuration! Please refresh your page to try again. If this continues to happen, please <a href="https://kbase.us/contact-us/">click here</a> to contact KBase with the problem.');
                return;
            }

            this.wsClient = new Workspace(this.wsUrl, {'token': this.token});
            this.serviceClient = new GenericClient(Config.url('service_wizard'), {'token': this.token});

            var mrg = {margin: '10px 0px 10px 0px'};
            var typeInput = $('<select class="form-control kb-import-filter">').css(mrg);
            for (var catPos in this.categories) {
                var cat = this.categories[catPos];
                var catName = this.categoryDescr[cat].name;
                typeInput.append('<option value="'+cat+'">'+catName+'</option>');
            }

            var typeFilter = $('<div class="col-sm-3">').append(typeInput);
            var filterInput = $('<input type="text" class="form-control kb-import-search" placeholder="Search data...">').css(mrg);
            typeInput.change(function() {
                this.searchAndRender(typeInput.val(), filterInput.val());
                /** HACK TO SHOW DATA POLICY **/
                if (!this.agreeDataPolicy && typeInput.val() === 'jgi_gateway') {
                    this.dataPolicyPanel.show();
                    this.showDataPolicy();
                }
                else {
                    this.dataPolicyPanel.hide();
                }
                /** END DATA POLICY HACK **/
            }.bind(this));
            filterInput.keyup(function(e) {
                this.searchAndRender(typeInput.val(), filterInput.val());
            }.bind(this));

            var searchFilter = $('<div class="col-sm-9">').append(filterInput);

            var header = $('<div class="row">').css({'margin': '0px 10px 0px 10px'}).append(typeFilter).append(searchFilter);
            this.$elem.append(header);
            this.totalPanel = $('<div>').css({'margin': '0px 0px 0px 10px'});
            this.$elem.append(this.totalPanel);

            var self = this;
            this.resultPanel = $('<div>')
                .css({'overflow-x' : 'hidden', 'overflow-y':'auto', 'height':this.mainListPanelHeight })
                .on('scroll', function() {
                    if($(this).scrollTop() + $(this).innerHeight() >= this.scrollHeight) {
                        self.renderMore();
                    }
                });
            this.$elem.append(this.resultPanel);
            this.searchAndRender(typeInput.val(), filterInput.val());
            return this;
        },

        searchAndRender: function(category, query) {
            var self = this;
            if (query) {
                query = query.trim();
                if (query.length == 0) {
                    query = '*';
                } else if (query.indexOf('"') < 0) {
                    var parts = query.split(/\s+/);
                    for (var i in parts)
                        if (parts[i].indexOf('*', parts[i].length - 1) < 0)
                            parts[i] = parts[i] + '*';
                    query = parts.join(' ');
                }
            } else {
                query = '*';
            }
            if (self.currentQuery && self.currentQuery === query && category === self.currentCategory)
                return;

            self.totalPanel.empty();
            self.resultPanel.empty();
            self.totalPanel.append($('<span>').addClass('kb-data-list-type').append('<img src="'+this.loadingImage+'"/> searching...'));
            self.objectList = [];
            self.currentCategory = category;
            self.currentQuery = query;
            self.currentPage = 0;
            self.totalResults = null;
            self.renderMore();
        },

        renderFromWorkspace: function(cat) {
            if (this.currentPage > 0)
                return;
            this.currentPage++;
            var type = cat.type;
            var ws = cat.ws;

            var thisQuery = this.currentQuery;
            Promise.resolve(this.serviceClient.sync_call(
                'NarrativeService.list_objects_with_sets',
                [{
                    ws_name: ws,
                    types: [type]
                }]
            ))
            .then(function(data) {
                data = data[0]['data'];
                if (thisQuery !== this.currentQuery)
                    return;
                var query = this.currentQuery.replace(/[\*]/g,' ').trim().toLowerCase();
                for (var i=0; i<data.length; i++) {
                    var info = data[i].object_info;
                    // object_info:
                    // [0] : obj_id objid // [1] : obj_name name // [2] : type_string type
                    // [3] : timestamp save_date // [4] : int version // [5] : username saved_by
                    // [6] : ws_id wsid // [7] : ws_name workspace // [8] : string chsum
                    // [9] : int size // [10] : usermeta meta
                    var name = info[1];
                    var id = info[0];
                    var metadata = {};
                    var objectMeta = info[10] || {}
                    if (this.currentCategory === 'plant_gnms') {
                        if (objectMeta.Name) {
                            metadata['ID'] = id;
                            name = objectMeta.Name;
                        }
                        metadata['Source'] = objectMeta.Source;
                        metadata['Genes'] = objectMeta['Number features'];
                    }
                    if(query) {
                        if (name.toLowerCase().indexOf(query) == -1)
                            continue;
                    }
                    this.objectList.push({
                        $div: null,
                        info: info,
                        id: id,
                        name: name,
                        metadata: metadata,
                        ws: cat.ws,
                        type: cat.type,
                        attached: false
                    });
                    this.attachRow(this.objectList.length - 1);
                }
                data.totalResults = this.objectList.length;
                this.totalPanel.empty();
                this.totalPanel.append($('<span>').addClass('kb-data-list-type')
                        .append('Total results: ' + data.totalResults));
            }.bind(this))
            .catch(function(error) {
                console.error(error);
                this.totalPanel.empty();
                this.totalPanel.append($('<span>').addClass('kb-data-list-type')
                        .append('Total results: 0'));
            }.bind(this));
        },

        renderFromSearch: function(cat) {
            this.currentPage++;
            // remove all periods from query since SOLR does those literally and returns unexpected things
            this.currentQuery = this.currentQuery.replace(/\./g, '');
            this.search(this.currentCategory, this.currentQuery, this.itemsPerPage, this.currentPage, function(query, data) {
                if (query !== this.currentQuery) {
                    return;
                }
                this.totalPanel.empty();
                if (!this.totalResults) {
                    this.totalResults = data.totalResults;
                }
                if (this.currentCategory === 'genomes') {
                    for (var i in data.items) {
                        var id = data.items[i].genome_id;
                        var name = data.items[i].scientific_name;
                        var domain = data.items[i].domain;
                        var contigs = data.items[i].num_contigs;
                        var genes = data.items[i].num_cds;
                        this.objectList.push({
                            $div: null,
                            info: null,
                            id: id,
                            name: name,
                            metadata: {'Domain': domain, 'Contigs': contigs, 'Genes': genes},
                            ws: cat.ws,
                            type: cat.type,
                            attached: false,
                            ws_ref:null
                        });
                        this.attachRow(this.objectList.length - 1);
                    }
                }
                else if (this.currentCategory === 'reference_genomes') {
                    for (var i in data.items) {
                        var genome_record = data.items[i];
                        var id = genome_record.genome_id;
                        var source = genome_record.genome_source;
                        var genome_source_id = '';
                        if(genome_record['genome_source_id']) {
                            genome_source_id = '- ' + String(genome_record['genome_source_id']);
                        }
                        var name = genome_record.scientific_name;
                        var domain = genome_record.domain;
                        var n_contigs = genome_record.num_contigs;
                        var num_cds = genome_record.num_cds;
                        var ws_ref = null;
                        if(genome_record['ws_ref']){
                            ws_ref = genome_record['ws_ref'];
                        }
                        var ws_name = cat.ws;
                        if(genome_record['workspace_name']) {
                            ws_name = genome_record['workspace_name'];
                        }
                        console.log(genome_record);
                        this.objectList.push({
                            $div: null,
                            info: null,
                            id: id,
                            name: name,
                            metadata: {
                                'Domain': domain,
                                'Source': id + ' (' + source + ') ' + genome_source_id,
                                'Contigs': String(n_contigs) + ', Genes: ' + String(num_cds)
                            },
                            ws: ws_name,
                            type: cat.type,
                            attached: false,
                            ws_ref: ws_ref
                        });
                        this.attachRow(this.objectList.length - 1);
                    }
                }
                this.totalPanel.append($('<span>').addClass('kb-data-list-type')
                    .append('Total results: ' + data.totalResults +
                            ' (' + this.objectList.length + ' shown)'));
            }.bind(this),
            function(error) {
                console.error(error);
                if (this.objectList.length == 0) {
                    this.totalPanel.empty();
                    this.totalPanel.append($('<span>').addClass('kb-data-list-type')
                        .append('Total results: 0'));
                }
            }.bind(this));
        },

        searchInService: function(query, page, service) {
            if (service === 'jgi_gateway') {
                return Promise.resolve(this.serviceClient.sync_call(
                    'jgi_gateway.search_jgi',
                    [{
                        search_string: query,
                        limit: this.itemsPerPage,
                        page: page-1
                    }]
                ))
                .then(function(results) {
                    return Promise.try(function() {
                        return {
                            query: query,
                            results: results
                        };
                    });
                });
            }
        },

        stageFile: function(source, id) {
            return function() {
                if (source === 'jgi') {
                    return Promise.resolve(this.serviceClient.sync_call(
                        'jgi_gateway.stage_objects',
                        [{ ids: [id] }]
                    ));
                }
            }.bind(this);
        },

        renderFromService: function(cat) {
            this.currentServiceQuery = this.currentQuery;
            this.currentPage++;
            this.searchInService(this.currentServiceQuery, this.currentPage, cat.source)
            .then(function(results) {
                if (results.query !== this.currentQuery) {
                    return;
                }
                var items = results.results[0];
                console.log(results.results);

                for (var i=0; i<items.hits.length; i++) {
                    var hit = items.hits[i];
                    this.objectList.push({
                        $div: null,
                        info: null,
                        id: hit._id,
                        name: hit._source.file_name,
                        ws: null,
                        type: 'JGI.File',
                        attached: false,
                        // modDate: hit._source.file_date,
                        copyAction: this.stageFile('jgi', hit._id),
                        hitMetadata: hit._source.metadata,
                        metadata: {
                            'File Id': hit._id,
                            'File Type': hit._source.file_type[0],
                            'Project Id': hit._source.metadata.sequencing_project_id
                        }
                    });
                    this.attachRow(this.objectList.length - 1, true);
                }
                this.totalPanel.empty();
                this.totalPanel.append($('<span>').addClass('kb-data-list-type')
                    .append('Results: ' + this.objectList.length + ' of ' + items.total));
            }.bind(this))
            .catch(function(error) {
                console.error(error);
                this.showError('Unable to retrieve public data.');
                this.totalPanel.empty();
            }.bind(this));
        },

        showDataPolicy: function() {
            var showPolicyModal = function() {
                var policyDialog = new BootstrapDialog({
                    title: 'JGI Data Usage and Download Policy (October 1, 2013)',
                    body: JGIDataPolicyHtml,
                    closeButton: true,
                    enterToTrigger: true,
                    buttons: [$('<button class="kb-primary-btn">OK</button>').click(function() {
                        policyDialog.hide();
                    })]
                });
                policyDialog.getElement().one('hidden.bs.modal', function() {
                    policyDialog.destroy();
                });
                policyDialog.show();
            };

            var $dataPolicyAlert = $(Handlebars.compile(DataPolicyPanelHtml)());
            $dataPolicyAlert.find('#view_policy_btn')
                .click(function() {
                    showPolicyModal();
                });
            $dataPolicyAlert.find('#agree_policy_btn')
                .click(function() {
                    this.agreeDataPolicy = true;
                    $dataPolicyAlert.slideUp();
                }.bind(this));

            this.dataPolicyPanel.empty().append($dataPolicyAlert);
        },

        renderMore: function() {
            this.hideError();
            var cat = this.categoryDescr[this.currentCategory];
            if (!cat.search && cat.ws) {
                this.renderFromWorkspace(cat);
            } else if (cat.search) {
                this.renderFromSearch(cat);
            } else {
                this.renderFromService(cat);
            }
        },

        attachRow: function(index, toStaging) {
            var obj = this.objectList[index];
            if (obj.attached) {
                return;
            }
            if (obj.$div) {
                this.resultPanel.append(obj.$div);
            } else {
                obj.$div = toStaging ? this.renderStagingObjectRowDiv(obj) : this.renderObjectRowDiv(obj);
                this.resultPanel.append(obj.$div);
            }
            obj.attached = true;
            this.n_objs_rendered++;
        },

        escapeSearchQuery: function(str) {
            return str.replace(/[\%]/g, '').replace(/[\:\"\\]/g, '\\$&');
        },

        search: function (category, query, itemsPerPage, pageNum, ret, errorCallback) {
            var escapedQ = this.escapeSearchQuery(query);
            var url = this.searchUrlPrefix + '?itemsPerPage=' + itemsPerPage + '&' +
                'page=' + pageNum + '&q=' + encodeURIComponent(escapedQ) + '&category=' + category;

            return Promise.resolve($.get(url))
                .then(function(data) {
                    ret(query, data);
                })
                .catch(function(error) {
                    if(errorCallback) {
                        errorCallback(error);
                    }
                });
        },

        renderObjectRowDiv: function(object) {
            var self = this;
            var type_tokens = object.type.split('.');
            // var type_module = type_tokens[0];
            var type = type_tokens[1].split('-')[0];
            var copyText = ' Add';

            var $addDiv =
                $('<div>').append(
                    $('<button>').addClass('kb-primary-btn').css({'white-space':'nowrap', padding:'10px 15px'})
                        .append($('<span>').addClass('fa fa-chevron-circle-left')).append(copyText)
                        .on('click',function() { // probably should move action outside of render func, but oh well
                            $(this).attr('disabled', 'disabled');
                            $(this).html('<img src="'+self.loadingImage+'">');

                            var thisBtn = this;
                            var targetName = object.name;
                            if (!isNaN(targetName))
                                targetName = self.categoryDescr[self.currentCategory].type.split('.')[1] + ' ' + targetName;
                            targetName = targetName.replace(/[^a-zA-Z0-9|\.\-_]/g,'_');
                            self.copy(object, targetName, thisBtn);
                        }));

            var shortName = object.name;
            var isShortened=false;
            if (shortName.length>this.maxNameLength) {
                shortName = shortName.substring(0,this.maxNameLength-3)+'...';
                isShortened=true;
            }
            var landingPageLink = this.options.lp_url + object.ws + '/' + object.id;
            var provenanceLink = '/#objgraphview/'+object.ws+'/'+object.id;
            if(object['ws_ref']) {
                landingPageLink = this.options.lp_url + object.ws_ref;
                provenanceLink = '/#objgraphview/' + object.ws_ref;
            }
            var $name = $('<span>')
                        .addClass('kb-data-list-name')
                        .append('<a href="'+landingPageLink+'" target="_blank">' + shortName + '</a>');
            if (isShortened) { $name.tooltip({title:object.name, placement:'bottom'}); }

            var $btnToolbar = $('<span>').addClass('btn-toolbar pull-right').attr('role', 'toolbar').hide();
            var btnClasses = 'btn btn-xs btn-default';
            var css = {'color':'#888'};
            var $openLandingPage = $('<span>')
                                        // tooltips showing behind pullout, need to fix!
                                        //.tooltip({title:'Explore data', 'container':'#'+this.mainListId})
                                        .addClass(btnClasses)
                                        .append($('<span>').addClass('fa fa-binoculars').css(css))
                                        .click(function(e) {
                                            e.stopPropagation();
                                            window.open(landingPageLink);
                                        });

            var $openProvenance = $('<span>')
                                        .addClass(btnClasses).css(css)
                                        //.tooltip({title:'View data provenance and relationships', 'container':'body'})
                                        .append($('<span>').addClass('fa fa-sitemap fa-rotate-90').css(css))
                                        .click(function(e) {
                                            e.stopPropagation();
                                            window.open(provenanceLink);
                                        });
            $btnToolbar.append($openLandingPage).append($openProvenance);

            var titleElement = $('<span>').css({'margin':'10px'}).append($btnToolbar.hide()).append($name);

            var hasMetadata = false;
            for (var key in object.metadata) {
                if (!object.metadata.hasOwnProperty(key))
                    continue;
                var val = object.metadata[key];
                if (!val)
                    val = '-';
                var value = $('<span>')
                            .addClass('kb-data-list-type')
                            .append('&nbsp;&nbsp;' + key + ':&nbsp;' + val);
                titleElement.append('<br>').append(value);
                hasMetadata = true;
            }
            if(!hasMetadata) {
                titleElement.append('<br>').append('&nbsp;');
            }

            // Set data icon
            var $logo = $('<span>');
            Icon.buildDataIcon($logo, type);
            var $topTable = $('<table>')
                // set background to white looks better on DnD
                .css({'width':'100%','background':'#fff'})
                .append($('<tr>')
                    .append($('<td>')
                        .css({'width':'90px'})
                                        .append($addDiv.hide()))
                         .append($('<td>')
                                         .css({'width':'50px'})
                                         .append($logo))
                         .append($('<td>')
                                         .append(titleElement)));
            var $row = $('<div>')
                        .css({margin:'2px',padding:'4px','margin-bottom': '5px'})
                        //.addClass('kb-data-list-obj-row')
                        .append($('<div>').addClass('kb-data-list-obj-row-main')
                                    .append($topTable))
                        // show/hide ellipses on hover, show extra info on click
                        .mouseenter(function(){
                            //if (!$moreRow.is(':visible')) { $toggleAdvancedViewBtn.show(); }
                            $addDiv.show();
                            $btnToolbar.show();
                        })
                        .mouseleave(function(){
                            //$toggleAdvancedViewBtn.hide();
                            $addDiv.hide();
                            $btnToolbar.hide();
                        });

            var $rowWithHr = $('<div>')
                                    .append($('<hr>')
                                                .addClass('kb-data-list-row-hr')
                                                .css({'margin-left':'155px'}))
                                    .append($row);
            return $rowWithHr;
        },

        renderStagingObjectRowDiv: function(object) {
            // basic rendering
            var $row = $(this.stagingRowTmpl({
                displayName: object.name,
                objModDate: object.modDate,
                simpleMetadata: object.metadata,
                buttonIcon: 'fa-chevron-circle-right',
                buttonAction: 'Stage',
                actionLeft: false,
                detailedMetadata: object.hitMetadata
            }));
            Icon.buildDataIcon($row.find('#icon'), 'file');

            // event binding
            $row.mouseenter(function() {
                $row.find('#action-button-div').show();
                $row.find('.btn-toolbar').show();
                $row.find('#meta-toggle').show();
            })
            .mouseleave(function() {
                $row.find('#action-button-div').hide();
                $row.find('.btn-toolbar').hide();
                $row.find('#meta-toggle').hide();
            });

            $row.find('#more-metadata').empty().html('<pre>' + StringUtil.prettyPrintJSON(object.hitMetadata) + '</pre>');
            $row.find('#meta-toggle button').click(function() {
                $row.find('#more-metadata').slideToggle();
            });

            var self = this;
            $row.find('#action-button-div button').click(function() {
                if (!self.agreeDataPolicy) {
                    alert('You must agree to the JGI Data Policy before copying.');
                    return;
                }
                $(this).attr('disabled', 'disabled');
                $(this).html('<img src="' + Config.get('loading_gif') + '">');

                object.copyAction().then(function(results) {
                    console.log(results);
                    $(this).html('Copied!');
                }.bind(this))
                .catch(function(error) {
                    console.error(error);
                    $(this).html('Error!');
                }.bind(this));
            });
            return $row;
        },

        copy: function(object, targetName, thisBtn, suffix) {
            if (suffix && suffix > this.maxAutoCopyCount) {
                this.copyPrompt(object, targetName, thisBtn);
                return;
            }
            var correctedTargetName = targetName;
            if (suffix) {
                correctedTargetName += '_' + suffix;
            } else {
                suffix = 1;
            }

            Promise.resolve(this.wsClient.get_object_info_new({
                objects: [{ref: this.wsName + '/' + correctedTargetName}]
            }))
            .then(function(info) {
                this.copy(object, targetName, thisBtn, suffix + 1);
            }.bind(this))
            .catch(function(error) {
                if (error.error && error.error.message && error.error.message.indexOf(
                    'No object with name ' + correctedTargetName + ' exists in workspace') === 0) {
                    this.copyFinal(object, correctedTargetName, thisBtn);
                }
                else {
                    this.copyPrompt(object, targetName, thisBtn, true);
                }
            }.bind(this));
        },

        copyPrompt: function(object, targetName, thisBtn, withError) {
            var self = this;
            $(thisBtn).prop('disabled', false);
            $(thisBtn).html('<span class="fa fa-chevron-circle-left"/> Add');
            var $input = $('<input/>').attr('type','text').addClass('form-control').val(targetName);
            var dialog = $('<div/>').append($('<p/>').addClass('rename-message')
                    .html('Enter target object name' +
                            (withError ? ':' : ' (or leave current one for overwriting):')))
                            .append($('<br/>')).append($input);
            Jupyter.dialog.modal({
                title: withError ? 'There are some problems checking object existence' :
                    'Object with this name already exists',
                body: dialog,
                buttons : {
                    'Cancel': {},
                    'OK': {
                        class: 'btn btn-primary',
                        click: function () {
                            var newName = $(this).find('input').val();
                            self.copyFinal(object, newName, thisBtn);
                            return true;
                        }
                    }
                },
                open : function () {
                    var dlg = $(this);
                    // Upon ENTER, click the OK button.
                    dlg.find('input[type="text"]').keydown(function (event) {
                        if (event.which === Jupyter.utils.keycodes.ENTER)
                            dlg.find('.btn-primary').first().click();
                    });
                    dlg.find('input[type="text"]').focus();
                }
            });
        },

        copyFinal: function(object, targetName, thisBtn) {
            var ref = object.ws + '/' + object.id;
            if(object['ws_ref']) {
                ref = object['ws_ref'];
            }
            Promise.resolve(this.serviceClient.sync_call(
                'NarrativeService.copy_object',
                [{
                    ref: object.ws + '/' + object.id,
                    target_ws_name: this.wsName
                }]
            ))
            .then(function(info) {
                $(thisBtn).prop('disabled', false);
                $(thisBtn).html('<span class="fa fa-chevron-circle-left"/> Add');
                this.trigger('updateDataList.Narrative');
            }.bind(this))
            .catch(function(error) {
                $(thisBtn).html('Error');
                if (error.error && error.error.message) {
                    if (error.error.message.indexOf('may not write to workspace')>=0) {
                        this.options.$importStatus.html($('<div>').css({'color':'#F44336','width':'500px'}).append('Error: you do not have permission to add data to this Narrative.'));
                    } else {
                        this.options.$importStatus.html($('<div>').css({'color':'#F44336','width':'500px'}).append('Error: '+error.error.message));
                    }
                } else {
                    this.options.$importStatus.html($('<div>').css({'color':'#F44336','width':'500px'}).append('Unknown error!'));
                }
                console.error(error);
            }.bind(this));
        },

        showError: function(error) {
            var errorMsg = error;
            if (error.error && error.error.message)
                errorMsg = error.error.message;
            this.infoPanel.empty();
            this.infoPanel.append('<div class="alert alert-danger">Error: '+errorMsg+'</span>');
        },

        hideError: function() {
            this.infoPanel.empty();
        },

        loggedInCallback: function(event, auth) {
            this.token = auth.token;
            return this;
        },

        loggedOutCallback: function() {
            this.token = null;
            return this;
        }
    });
});
